// Settings shared by the service worker, the card and the options page. Stored in chrome.storage.sync so they follow
// the user's browser profile.
export const DEFAULTS = {
  backendUrl: 'http://localhost:8000', // the FastAPI server
  siteUrl: 'http://localhost:5173', // the VoxShield website, where History and the full report live
  consented: false, // set once the user has read the first-use note
}

export async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULTS)
  return { ...DEFAULTS, ...stored }
}

export const saveSettings = (changes) => chrome.storage.sync.set(changes)

/** Trailing slashes off, so "<url>/api/..." joins cleanly. Throws if it is not an http(s) URL. */
export function normalizeUrl(value) {
  let url
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('That is not a valid address. Example: http://localhost:8000')
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error('Use an http:// or https:// address.')
  return url.origin + url.pathname.replace(/\/+$/, '')
}
