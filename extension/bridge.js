// Runs only on the VoxShield website. It carries extension results from chrome.storage into the page, where the site's
// own History code stores them with source "extension". Content scripts share the window with the page, so a
// postMessage to the same window is enough. The page checks the message shape before trusting it.
;(() => {
  const deliver = (results) => window.postMessage({ type: 'voxshield-extension-results', results }, window.location.origin)

  chrome.storage.local.get('results').then(({ results = [] }) => {
    if (results.length) deliver(results)
  })
  // New results arrive while the site is open.
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'results') deliver(message.results)
  })
  // The page may mount its listener after this script ran; it asks, and we answer.
  window.addEventListener('message', (event) => {
    if (event.source === window && event.data?.type === 'voxshield-extension-ready') {
      chrome.storage.local.get('results').then(({ results = [] }) => deliver(results))
    }
  })
})()
