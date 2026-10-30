import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

import { CallSession } from '../lib/liveCall/session'

/** One call session for the page. Leaving the page, or closing the tab, ends the call and releases the microphone. */
export function useLiveCall() {
  const [session, setSession] = useState(() => new CallSession())
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot)

  useEffect(() => {
    const leave = () => session.end('you')
    window.addEventListener('pagehide', leave)
    return () => {
      window.removeEventListener('pagehide', leave)
      // An idle session holds nothing; this also keeps React's development double-mount from ending a fresh one.
      if (session.getSnapshot().phase !== 'idle') session.end('you')
    }
  }, [session])

  const reset = useCallback(() => setSession(new CallSession()), [])
  return { session, snapshot, reset }
}

/** The current time, ticking every second while `active`. */
export function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}
