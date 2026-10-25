import { useEffect, useState } from 'react'

import { getHealth, getLimits, type Health, type Limits } from '../lib/api'

export type BackendState =
  | { status: 'checking' }
  | { status: 'online'; health: Health; limits: Limits }
  | { status: 'offline' }

export function useBackend(): BackendState {
  const [state, setState] = useState<BackendState>({ status: 'checking' })

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([getHealth(controller.signal), getLimits(controller.signal)])
      .then(([health, limits]) => setState({ status: 'online', health, limits }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'offline' })
      })
    return () => controller.abort()
  }, [])

  return state
}
