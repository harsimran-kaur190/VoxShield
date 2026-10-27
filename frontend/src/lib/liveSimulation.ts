/**
 * The clock that plays the prewritten demo script back. It only moves a number forward; it does not record, transcribe
 * or analyze anything. The dashboard drives it with one interval that runs only while the status is "running".
 */

export type SimulationStatus = 'running' | 'paused' | 'finished' | 'ended'

export interface SimulationState {
  status: SimulationStatus
  /** Seconds of the script played so far. */
  elapsed: number
  duration: number
}

export type SimulationAction =
  | { type: 'tick'; seconds: number }
  /** Follow the demo audio's position, so the transcript stays in step with the voice. */
  | { type: 'syncTo'; elapsed: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'end' }
  | { type: 'restart' }

export const TICK_MS = 250

export const startSimulation = (duration: number): SimulationState => ({ status: 'running', elapsed: 0, duration })

export const isOver = (state: SimulationState) => state.status === 'finished' || state.status === 'ended'

export function simulationReducer(state: SimulationState, action: SimulationAction): SimulationState {
  switch (action.type) {
    case 'tick': {
      if (state.status !== 'running') return state
      const elapsed = Math.min(state.duration, state.elapsed + action.seconds)
      return { ...state, elapsed, status: elapsed >= state.duration ? 'finished' : 'running' }
    }
    case 'syncTo': {
      if (state.status !== 'running' || !Number.isFinite(action.elapsed)) return state
      const elapsed = Math.min(state.duration, Math.max(0, action.elapsed))
      return { ...state, elapsed, status: elapsed >= state.duration ? 'finished' : 'running' }
    }
    case 'pause':
      return state.status === 'running' ? { ...state, status: 'paused' } : state
    case 'resume':
      return state.status === 'paused' ? { ...state, status: 'running' } : state
    case 'end':
      return isOver(state) ? state : { ...state, status: 'ended' }
    case 'restart':
      return startSimulation(state.duration)
  }
}
