/**
 * Keeps track of which analysis request is the current one. Starting a new run aborts the previous request and makes
 * its late results stale, and cancelling (for example when the page is left) aborts the request that is in flight, so
 * an abandoned analysis neither keeps the server busy nor can ever update what the user sees.
 */
export interface Run {
  signal: AbortSignal
  /** False once a newer run began or the tracker was cancelled. Results from a run that is not current are dropped. */
  isCurrent: () => boolean
}

export class RunTracker {
  private controller: AbortController | null = null
  private latest = 0

  begin(): Run {
    this.controller?.abort()
    const controller = new AbortController()
    this.controller = controller
    const id = ++this.latest
    return { signal: controller.signal, isCurrent: () => this.latest === id }
  }

  cancel(): void {
    this.controller?.abort()
    this.controller = null
    this.latest++
  }
}
