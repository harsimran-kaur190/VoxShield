/**
 * State of the simulated incoming call. Nothing here touches a phone, the microphone or the network:
 * accepting or declining only changes what the demo screen shows.
 */

export type CallPhase = 'ringing' | 'accepted' | 'declined'
export type CallAction = 'accept' | 'decline' | 'restart'

export const INITIAL_CALL_PHASE: CallPhase = 'ringing'

export function callReducer(phase: CallPhase, action: CallAction): CallPhase {
  switch (action) {
    case 'accept':
    case 'decline':
      // Only a ringing call can be answered; a second press does nothing.
      return phase === 'ringing' ? (action === 'accept' ? 'accepted' : 'declined') : phase
    case 'restart':
      return 'ringing'
  }
}

export const CALL_DISCLAIMER = 'This is a local demonstration. No real phone call is being placed or intercepted.'

/** Where "Continue to Analysis Demo" leads. */
export const DEMO_ANALYSIS_PATH = '/demo/analysis'
export const DEMO_CALL_PATH = '/demo/call'
/** Placeholder for the forensic report built in the next stage. */
export const DEMO_REPORT_PATH = '/demo/report'
