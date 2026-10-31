import { useEffect } from 'react'

import type { DeepTruthReport } from './deeptruth'
import { addEntry, getEntry } from './history'

/**
 * Receives results from the VoxShield Check browser extension. Its content script (extension/bridge.js) posts them to
 * this window; each one is added to History with source "extension". Only messages from this same window with the
 * expected shape are accepted, and a result already in History (same extension ID) is not added again.
 */

export const READY_MESSAGE = 'voxshield-extension-ready'
export const RESULTS_MESSAGE = 'voxshield-extension-results'

export interface ExtensionResult {
  externalId: string
  title: string
  pageUrl?: string
  report: DeepTruthReport
}

function isResult(value: unknown): value is ExtensionResult {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  const report = v.report as Record<string, unknown> | undefined
  return typeof v.externalId === 'string' && typeof v.title === 'string' && typeof report?.verdict === 'string' && Array.isArray(report.modules) && Array.isArray(report.limitations)
}

/** Adds the new results and returns how many were added. */
export function receiveResults(results: unknown): number {
  if (!Array.isArray(results)) return 0
  let added = 0
  // Oldest first, so the newest ends up at the top of History.
  for (const result of [...results].reverse()) {
    if (!isResult(result) || getEntry(result.externalId)) continue
    addEntry({ kind: 'deeptruth', source: 'extension', title: result.title, pageUrl: result.pageUrl, externalId: result.externalId, report: result.report })
    added++
  }
  return added
}

export function handleMessage(event: MessageEvent): void {
  if (event.source !== window || event.data?.type !== RESULTS_MESSAGE) return
  receiveResults(event.data.results)
}

/** Listens for the extension while the app is mounted, and tells it the page is ready to receive. */
export function useExtensionBridge() {
  useEffect(() => {
    window.addEventListener('message', handleMessage)
    window.postMessage({ type: READY_MESSAGE }, window.location.origin)
    return () => window.removeEventListener('message', handleMessage)
  }, [])
}
