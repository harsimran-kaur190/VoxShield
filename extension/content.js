// The result card. Injected into the page when the user picks "Check with VoxShield". Everything renders inside a
// Shadow DOM so the page's CSS cannot restyle it and ours cannot leak out. Safe to inject twice: the guard below makes
// the second run a no-op.
;(() => {
  if (window.__voxshieldCheck) return
  window.__voxshieldCheck = true

  // Styles go in through CSSOM rather than a <style> tag, so a strict page Content-Security-Policy cannot block them.
  const CSS = `
    :host { all: initial; }
    .card { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; width: 340px; max-width: calc(100vw - 32px);
      font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1a1a1a; background: #fff; border: 1px solid #ddd;
      border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,.18); padding: 14px 16px; box-sizing: border-box; }
    .top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .brand { font-size: 12px; letter-spacing: .04em; color: #666; text-transform: uppercase; }
    .close { border: 0; background: none; font-size: 18px; line-height: 1; cursor: pointer; color: #666; padding: 2px 6px; }
    .verdict { margin: 10px 0 2px; font-size: 18px; font-weight: 600; }
    .high { color: #b42318; } .medium { color: #b54708; } .low { color: #067647; } .inconclusive { color: #475467; }
    .meta { color: #475467; font-size: 13px; }
    canvas { display: block; width: 100%; height: auto; margin-top: 10px; border-radius: 8px; background: #f2f4f7; }
    .caption { font-size: 12px; color: #667085; margin-top: 4px; }
    ul { margin: 8px 0 0; padding-left: 18px; font-size: 13px; }
    .limits { margin-top: 10px; padding-top: 10px; border-top: 1px solid #eee; font-size: 12px; color: #475467; }
    a { color: #175cd3; font-weight: 600; text-decoration: none; display: inline-block; margin-top: 10px; }
    .error { color: #b42318; margin-top: 8px; }
    .muted { color: #667085; }
    .row { display: flex; gap: 8px; margin-top: 12px; }
    .button { padding: 7px 14px; font: inherit; font-weight: 600; border: 0; border-radius: 8px; background: #1a1a1a; color: #fff; cursor: pointer; }
    .button.secondary { background: #f2f4f7; color: #1a1a1a; }
  `

  const host = document.createElement('div')
  host.id = 'voxshield-check-host'
  const shadow = host.attachShadow({ mode: 'closed' })
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(CSS)
  shadow.adoptedStyleSheets = [sheet]
  const card = document.createElement('div')
  card.className = 'card'
  card.setAttribute('role', 'dialog')
  card.setAttribute('aria-label', 'VoxShield Check result')
  shadow.appendChild(card)

  const show = () => {
    if (!host.isConnected) document.documentElement.appendChild(host)
  }
  const hide = () => host.remove()

  // Helpers that build DOM nodes without innerHTML, so nothing from the report is interpreted as markup.
  const el = (tag, className, text) => {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text != null) node.textContent = text
    return node
  }
  const header = () => {
    const top = el('div', 'top')
    top.append(el('span', 'brand', 'VoxShield Check'))
    const close = el('button', 'close', '×')
    close.setAttribute('aria-label', 'Close')
    close.onclick = hide
    top.append(close)
    return top
  }
  const render = (...children) => {
    card.replaceChildren(header(), ...children)
    show()
  }

  // The backend's four verdicts, shown as a risk level for the small card.
  const RISK = {
    'Likely manipulated': ['High', 'high'],
    'Mixed signals': ['Medium', 'medium'],
    'No manipulation detected': ['Low', 'low'],
    Inconclusive: ['Inconclusive', 'inconclusive'],
  }

  function renderResult(report, reportUrl) {
    const [risk, tone] = RISK[report.verdict] ?? ['Inconclusive', 'inconclusive']
    const pct = Math.round(report.manipulation_likelihood * 100)
    const nodes = [
      el('div', `verdict ${tone}`, `${report.verdict} · ${risk} risk`),
      el('div', 'meta', `Manipulation likelihood ${pct}% · confidence ${Math.round(report.confidence * 100)}%`),
    ]
    if (report.verdict_reason) nodes.push(el('div', 'meta', report.verdict_reason))

    const heatmap = report.modules.flatMap((m) => m.evidence).find((e) => e.type === 'heatmap')
    if (heatmap) {
      nodes.push(drawHeatmap(heatmap.data.values), el('div', 'caption', `${heatmap.label}. Bright = changed more.`))
    } else {
      // Audio and video have no heatmap: list what each module concluded, with how many time windows it flagged.
      const list = el('ul')
      for (const m of report.modules) {
        const windows = m.evidence.find((e) => e.type === 'timeline' || e.type === 'spectrogram')?.data
        const flagged = (windows?.windows ?? windows?.flagged ?? []).filter((w) => w.flagged !== false).length
        const suffix = m.status === 'ok' && (windows?.windows || windows?.flagged) ? ` (${flagged} flagged segment${flagged === 1 ? '' : 's'})` : ''
        list.append(el('li', null, `${m.modality.replace('_', ' ')}: ${m.summary || m.error || 'no result'}${suffix}`))
      }
      nodes.push(list)
    }

    // Always shown: what this result cannot tell you.
    const limits = report.limitations.length ? report.limitations.slice(0, 2).join(' ') : 'No specific limitations were reported for this file.'
    nodes.push(el('div', 'limits', `Limitations: ${limits}`))

    const link = el('a', null, 'View full report →')
    link.href = reportUrl
    link.target = '_blank'
    link.rel = 'noopener'
    nodes.push(link)
    render(...nodes)
  }

  // Heatmap values are 0-255 per cell (rows top to bottom). Painted as a single orange channel, light to dark.
  function drawHeatmap(values) {
    const canvas = document.createElement('canvas')
    const rows = values.length
    const cols = values[0]?.length ?? 0
    canvas.width = cols
    canvas.height = rows
    const ctx = canvas.getContext('2d')
    const image = ctx.createImageData(cols, rows)
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const v = values[y][x] / 255
        const i = (y * cols + x) * 4
        image.data[i] = 255
        image.data[i + 1] = Math.round(245 - 160 * v)
        image.data[i + 2] = Math.round(235 - 235 * v)
        image.data[i + 3] = 255
      }
    }
    ctx.putImageData(image, 0, 0)
    canvas.style.imageRendering = 'pixelated'
    return canvas
  }

  // One title and hint per error code from background.js, with the specific detail underneath.
  const ERRORS = {
    offline: ['VoxShield backend is offline', 'Start the backend (uvicorn app.main:app --port 8000) or set its address in the extension options.'],
    blocked: ['The site blocked the download', 'Some sites refuse requests that do not come from their own pages. Try saving the image and uploading it on the VoxShield site instead.'],
    too_large: ['File too large', 'Try a smaller copy of the file, or upload it on the VoxShield site, which shows the limits.'],
    unsupported: ['Unsupported media type', 'VoxShield checks images (JPEG, PNG, WebP, GIF…), audio clips and videos.'],
    streamed: ['Streamed media', ''],
    backend: ['The backend could not analyse this file', ''],
    unknown: ['Something went wrong', ''],
  }

  function renderError(code, detail) {
    const [title, hint] = ERRORS[code] ?? ERRORS.unknown
    const nodes = [el('div', 'verdict', title), el('div', 'error', detail)]
    if (hint) nodes.push(el('div', 'meta', hint))
    render(...nodes)
  }

  // Shown once, before the first analysis. Nothing is sent until the user clicks Continue.
  function renderConsent(job) {
    const cont = el('button', 'button', 'Continue')
    cont.onclick = () => chrome.runtime.sendMessage({ type: 'consent-accepted', job })
    const cancel = el('button', 'button secondary', 'Cancel')
    cancel.onclick = hide
    const row = el('div', 'row')
    row.append(cont, cancel)
    render(el('div', 'verdict', 'Before the first check'), el('div', 'meta', 'The selected media is sent to your VoxShield backend for analysis. Files are not stored; only scores and reasons are kept.'), row)
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'consent') {
      renderConsent(message.job)
    } else if (message.type === 'analysing') {
      const what = message.mediaType === 'image' ? 'image' : message.mediaType === 'audio' ? 'audio clip' : message.mediaType === 'video' ? 'video' : 'file'
      const slow = message.mediaType === 'video' ? ' A video is checked frame by frame for its first minute, then its audio track, so it takes longer than a photo.' : ''
      render(el('div', 'verdict muted', 'Analysing…'), el('div', 'meta', `Sending the ${what} to your VoxShield backend. The first check after a restart can take a minute while the models load.${slow}`))
    } else if (message.type === 'result') {
      renderResult(message.report, message.reportUrl)
    } else if (message.type === 'error') {
      renderError(message.code, message.message)
    }
  })
})()
