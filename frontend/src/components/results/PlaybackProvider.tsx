import type { ReactNode } from 'react'

import { PlaybackContext } from '../../hooks/playbackContext'
import type { AudioController } from '../../lib/audioController'

export function PlaybackProvider({ controller, children }: { controller: AudioController; children: ReactNode }) {
  return <PlaybackContext.Provider value={controller}>{children}</PlaybackContext.Provider>
}
