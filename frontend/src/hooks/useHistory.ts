import { useSyncExternalStore } from 'react'

import { getEntries, subscribe } from '../lib/history'

/** This tab's completed analyses and simulations, newest first. */
export function useHistory() {
  return useSyncExternalStore(subscribe, getEntries, getEntries)
}
