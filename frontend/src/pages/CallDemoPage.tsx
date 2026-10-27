import { useReducer } from 'react'
import { useLocation } from 'react-router-dom'

import { CallScreen } from '../components/demo/CallScreen'
import { callReducer, INITIAL_CALL_PHASE } from '../lib/callSimulation'

export function CallDemoPage() {
  // Keyed by navigation, so "Launch Simulation" while on this page starts a fresh call.
  const { key } = useLocation()
  return <CallSimulation key={key} />
}

function CallSimulation() {
  const [phase, dispatch] = useReducer(callReducer, INITIAL_CALL_PHASE)
  return (
    <section aria-label="Simulated incoming call" className="py-4 sm:py-10">
      <CallScreen phase={phase} onAccept={() => dispatch('accept')} onDecline={() => dispatch('decline')} onRestart={() => dispatch('restart')} />
    </section>
  )
}
