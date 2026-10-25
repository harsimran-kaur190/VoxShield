import { createContext } from 'react'

import type { AudioController } from '../lib/audioController'

export const PlaybackContext = createContext<AudioController | null>(null)
