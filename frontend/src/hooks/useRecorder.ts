import { useEffect, useState, useSyncExternalStore } from 'react'

import type { Limits } from '../lib/api'
import { browserRecorderEnv } from '../lib/recorderEnv'
import { RecorderSession } from '../lib/recorderSession'
import { recorderLimits } from '../lib/recording'

export function useRecorder(limits: Limits | null) {
  const [session] = useState(() => new RecorderSession(browserRecorderEnv(), recorderLimits(limits)))
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot)

  useEffect(() => {
    session.configure(recorderLimits(limits))
  }, [session, limits])

  // Leaving the page, or unmounting for any reason, stops the microphone and frees the recording.
  useEffect(() => session.attach(), [session])

  return { snapshot, maxSeconds: recorderLimits(limits).maxSeconds, start: () => void session.start(), stop: () => session.stop(), discard: () => session.discard() }
}
