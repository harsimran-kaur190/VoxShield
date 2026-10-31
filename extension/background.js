// Service worker: owns the context menu, downloads the clicked media, sends it to the backend and reports back to the
// page. It runs only while there is work to do, so everything it needs is read from chrome.storage each time.
import { getSettings, saveSettings } from './settings.js'

const MENU_ID = 'voxshield-check' // on an <img>, <audio> or <video> element
const LINK_MENU_ID = 'voxshield-check-link' // on a link that points straight at a media file
const HISTORY_LIMIT = 25 // extension results kept for the website's History page

const MEDIA_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'heic', 'wav', 'mp3', 'm4a', 'flac', 'ogg', 'opus', 'aac', 'mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi']
// Sites that stream media in pieces (blob: URLs, DASH/HLS). There is no file to download, so say so instead of failing oddly.
const STREAMING_HOSTS = /(^|\.)(youtube\.com|youtu\.be|instagram\.com|x\.com|twitter\.com|tiktok\.com|facebook\.com|fb\.watch|vimeo\.com|twitch\.tv|netflix\.com|spotify\.com)$/i

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: MENU_ID, title: 'Check with VoxShield', contexts: ['image', 'audio', 'video'] })
  chrome.contextMenus.create({
    id: LINK_MENU_ID,
    title: 'Check linked file with VoxShield',
    contexts: ['link'],
    targetUrlPatterns: MEDIA_EXTENSIONS.flatMap((ext) => [`*://*/*.${ext}`, `*://*/*.${ext}?*`]),
  })
})

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return
  const srcUrl = info.menuItemId === MENU_ID ? info.srcUrl : info.menuItemId === LINK_MENU_ID ? info.linkUrl : null
  if (!srcUrl) return
  const job = { tabId: tab.id, srcUrl, pageUrl: info.pageUrl ?? tab.url ?? '', mediaType: info.mediaType ?? 'file' }
  // The card script is injected on demand, so no page is touched until the user asks.
  await chrome.scripting.executeScript({ target: { tabId: job.tabId }, files: ['content.js'] })
  const { consented } = await getSettings()
  // First use: the card explains where the media goes and waits for "Continue" (see the consent handler below).
  if (!consented) return send(job.tabId, { type: 'consent', job })
  check(job)
})

// The card answers the consent note. Accepting is remembered, so the note is shown once.
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'consent-accepted' && message.job) {
    saveSettings({ consented: true }).then(() => check(message.job))
  }
})

const send = (tabId, message) => chrome.tabs.sendMessage(tabId, message).catch(() => {}) // the tab may have navigated away

// An error the card can explain. `code` picks the title and the hint; `message` is the specific detail.
class CheckError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

async function check({ tabId, srcUrl, pageUrl, mediaType }) {
  const settings = await getSettings()
  send(tabId, { type: 'analysing', srcUrl, mediaType })
  try {
    checkStreamed(srcUrl, pageUrl, mediaType)
    const limits = await getLimits(settings.backendUrl)
    let file, url, original = null
    if (mediaType === 'image' && /^(blob|data):/.test(srcUrl)) {
      // WhatsApp Web and other dynamic sites show images from blob: URLs that only the page itself can read. The page
      // hands the bytes over (same tab, user-triggered), so the real decrypted image is analysed, not a screenshot.
      file = await readInPage(tabId, srcUrl, limits.maxBytes)
      url = srcUrl
    } else {
      // Pages usually show a resized, recompressed copy. Look for a larger original (srcset, or a link around the image).
      original = mediaType === 'image' ? await findOriginal(tabId, srcUrl) : null
      ;({ file, url } = await downloadBest(original?.candidates ?? [srcUrl], limits.maxBytes))
    }
    const report = await analyze(settings.backendUrl, file)
    noteCopyQuality(report, original, file, url !== srcUrl)
    const saved = await saveResult({ report, title: file.name, pageUrl, srcUrl })
    send(tabId, { type: 'result', report, reportUrl: `${settings.siteUrl}/reports/${saved.externalId}` })
    notifySite(saved)
  } catch (error) {
    const code = error instanceof CheckError ? error.code : 'unknown'
    send(tabId, { type: 'error', code, message: error instanceof Error ? error.message : String(error) })
  }
}

// Runs inside the page: read a blob:/data: image as base64 so the service worker can upload it.
async function readBlobInPage(srcUrl, maxBytes) {
  const response = await fetch(srcUrl)
  const blob = await response.blob()
  if (blob.size > maxBytes) return { error: 'too_large', size: blob.size }
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
  return { base64, type: blob.type, size: blob.size }
}

async function readInPage(tabId, srcUrl, maxBytes) {
  let result
  try {
    ;[{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: readBlobInPage, args: [srcUrl, maxBytes] })
  } catch {
    throw new CheckError('blocked', 'The page did not let the extension read this image.')
  }
  if (!result) throw new CheckError('blocked', 'The page did not let the extension read this image.')
  if (result.error === 'too_large') throw new CheckError('too_large', `This file is ${mb(result.size)}; the backend accepts up to ${mb(maxBytes)}.`)
  const bytes = Uint8Array.from(atob(result.base64), (c) => c.charCodeAt(0))
  return new File([bytes], filenameFor('https://page.local/image', result.type), { type: result.type })
}

// Runs inside the page: find the <img> that was clicked (by its current source) and list larger versions of it, best
// first: srcset candidates by width, then a link wrapping the image that points at an image file, then the shown source.
function collectOriginals(srcUrl) {
  const img = [...document.images].find((i) => i.currentSrc === srcUrl || i.src === srcUrl)
  if (!img) return null
  const candidates = []
  for (const entry of (img.srcset || '').split(',')) {
    const [url, size] = entry.trim().split(/\s+/)
    if (url) candidates.push({ url: new URL(url, document.baseURI).href, width: size?.endsWith('w') ? parseInt(size) : 0 })
  }
  candidates.sort((a, b) => b.width - a.width)
  const link = img.closest('a[href]')?.href
  const urls = candidates.map((c) => c.url)
  if (link && /\.(jpe?g|png|webp|gif|bmp|tiff?|heic)(\?|$)/i.test(link)) urls.unshift(link)
  urls.push(srcUrl)
  return { candidates: [...new Set(urls)], naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, displayedWidth: img.clientWidth }
}

async function findOriginal(tabId, srcUrl) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: collectOriginals, args: [srcUrl] })
    return result
  } catch {
    return null // e.g. a browser-internal page; fall back to the clicked source
  }
}

// Try each candidate in order; a blocked or over-sized candidate falls through to the next, the last one raises.
async function downloadBest(candidates, maxBytes) {
  let lastError
  for (const url of candidates) {
    try {
      return { file: await downloadMedia(url, maxBytes), url }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

// Record in the report when the detector only got the page's small copy. This is a fact the extension knows and the
// backend cannot, so it is added to the limitations list that the card, the website and History all show.
function noteCopyQuality(report, original, file, upgraded) {
  const kb = Math.round(file.size / 1024)
  if (upgraded) {
    report.limitations.unshift(`A larger version linked from the page was analysed (${kb} KB), not the thumbnail shown.`)
  } else if (original && original.naturalWidth > 0 && original.naturalWidth < 800) {
    report.limitations.unshift(`Only the page's copy was available (${original.naturalWidth}x${original.naturalHeight} px, ${kb} KB). Websites resize and recompress images, which erases the traces detectors rely on; the original file may give a different result.`)
  }
}

// Streamed video (YouTube, Instagram, X...) plays from blob: URLs or segment lists: there is no file to send.
const STREAMED_MESSAGE = "This video is streamed and can't be downloaded by the extension. Try an image or a direct media file."

function checkStreamed(srcUrl, pageUrl, mediaType) {
  const streamedPage = (() => {
    try {
      return STREAMING_HOSTS.test(new URL(pageUrl).hostname)
    } catch {
      return false
    }
  })()
  const notAFile = !/^https?:/.test(srcUrl) // blob:, data:, mediasource:
  if (mediaType === 'video' && (notAFile || streamedPage)) throw new CheckError('streamed', STREAMED_MESSAGE)
  if (notAFile && mediaType !== 'image') throw new CheckError('streamed', STREAMED_MESSAGE.replace('This video is', 'This media is'))
}

// The backend's upload limit, asked once per backend and kept in storage so the worker does not ask on every click.
async function getLimits(backendUrl) {
  const { limits } = await chrome.storage.local.get('limits')
  if (limits?.backendUrl === backendUrl) return limits
  let body
  try {
    body = await fetch(`${backendUrl}/api/v1/deeptruth/limits`).then((r) => r.json())
  } catch {
    throw new CheckError('offline', `No answer from ${backendUrl}.`)
  }
  const fresh = { backendUrl, maxMb: body.max_upload_mb, maxBytes: body.max_upload_mb * 1024 * 1024 }
  await chrome.storage.local.set({ limits: fresh })
  return fresh
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

// Download the media the user right-clicked. host_permissions lets the worker fetch from any site, but a site can still
// refuse (hotlink protection, login walls). The size is checked from the headers first, so a huge file is not pulled
// down only to be refused.
async function downloadMedia(srcUrl, maxBytes) {
  let response
  try {
    response = await fetch(srcUrl)
  } catch {
    throw new CheckError('blocked', 'The site did not let the extension download this media (network error or blocked request).')
  }
  if (!response.ok) throw new CheckError('blocked', `The site refused to hand over the media (HTTP ${response.status}).`)
  const tooLarge = (size) => new CheckError('too_large', `This file is ${mb(size)}; the backend accepts up to ${mb(maxBytes)}.`)
  const declared = Number(response.headers.get('content-length'))
  if (declared > maxBytes) throw tooLarge(declared)
  const blob = await response.blob()
  if (blob.size > maxBytes) throw tooLarge(blob.size)
  return new File([blob], filenameFor(srcUrl, blob.type), { type: blob.type })
}

// The backend checks the file extension before sniffing the bytes, and image URLs often have none, so make one from
// the content type when the URL does not already end in a known extension.
const EXTENSION_FOR = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/bmp': '.bmp', 'image/tiff': '.tiff',
  'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/wave': '.wav', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/flac': '.flac', 'audio/ogg': '.ogg', 'audio/opus': '.opus', 'audio/aac': '.aac',
  'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm', 'video/x-matroska': '.mkv', 'video/x-msvideo': '.avi',
}
const KNOWN = new RegExp(`\\.(${MEDIA_EXTENSIONS.join('|')})$`, 'i')

export function filenameFor(srcUrl, mimeType) {
  let name = 'media'
  try {
    name = decodeURIComponent(new URL(srcUrl).pathname.split('/').filter(Boolean).pop() || 'media')
  } catch {
    /* keep the fallback name */
  }
  name = name.slice(0, 120)
  if (KNOWN.test(name)) return name
  const ext = EXTENSION_FOR[mimeType.split(';')[0]]
  if (!ext) throw new CheckError('unsupported', `The media type is ${mimeType || 'unknown'}.`)
  return name + ext
}

// One multipart POST to the existing DeepTruth endpoint. The server deletes the file when the analysis ends.
async function analyze(backendUrl, file) {
  const body = new FormData()
  body.append('file', file, file.name)
  let response
  try {
    // Up to 4 minutes: the first analysis after a restart loads several GB of models, and a video takes a while.
    response = await fetch(`${backendUrl}/api/v1/deeptruth/analyze`, { method: 'POST', body, signal: AbortSignal.timeout(240_000) })
  } catch (error) {
    if (error?.name === 'TimeoutError') throw new CheckError('backend', 'The backend did not answer within 4 minutes. It may still be loading its models; try again in a minute.')
    throw new CheckError('offline', `No answer from ${backendUrl}.`)
  }
  if (!response.ok) {
    // The backend's own error body: { detail: { code, message } }.
    const detail = await response.json().then((b) => b?.detail).catch(() => null)
    const message = detail?.message || `The backend answered with HTTP ${response.status}.`
    if (response.status === 413 || detail?.code === 'file_too_large') throw new CheckError('too_large', message)
    if (response.status === 415 || detail?.code === 'unsupported_extension' || detail?.code === 'unrecognized_media') throw new CheckError('unsupported', message)
    throw new CheckError('backend', message)
  }
  return response.json()
}

// Results wait in chrome.storage.local until a VoxShield tab picks them up (see bridge.js). Only the report JSON is
// kept: scores, reasons and evidence, never the media itself.
async function saveResult(entry) {
  const saved = { ...entry, externalId: `EXT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, completedAt: new Date().toISOString() }
  const { results = [] } = await chrome.storage.local.get('results')
  await chrome.storage.local.set({ results: [saved, ...results].slice(0, HISTORY_LIMIT) })
  return saved
}

// If the website is already open, hand it the new result right away instead of waiting for a reload.
async function notifySite(saved) {
  const { siteUrl } = await getSettings()
  const tabs = await chrome.tabs.query({ url: `${siteUrl}/*` })
  for (const tab of tabs) chrome.tabs.sendMessage(tab.id, { type: 'results', results: [saved] }).catch(() => {})
}
