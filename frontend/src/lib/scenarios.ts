/**
 * The Scam Scenario Lab's sample situations. Each one is a short script that was read aloud by a computer-generated
 * voice and saved as an audio file (public/lab/*.flac). Nothing here records a result: findings, scores, and advice
 * only ever come from the backend analyzing the audio. `testing` and `lookFor` say what to examine, never what will
 * be found.
 */

export interface Scenario {
  id: string
  title: string
  /** What situation this sample puts in front of the detectors. */
  testing: string
  /** A question to hold while reading the result. It does not state an outcome. */
  lookFor: string
  /** The exact words spoken in the audio file. */
  script: string
  audioUrl: string
}

/** Said wherever a sample is shown, so a sample is never mistaken for a real call or a real detection. */
export const SAMPLE_LABEL = 'Sample audio: computer-generated speech (text-to-speech). Not a real call.'
export const SCRIPT_LABEL = 'Script spoken in the sample. Not a recording of a real person and not a detection result.'

export const SCENARIOS: Scenario[] = [
  {
    id: 'protective',
    title: 'Protective bank-security notice',
    testing: 'A message that warns about scams using the same words a scam would use: bank, password, PIN, code, verification.',
    lookFor: 'Whether advice not to share a code is told apart from a request for one.',
    script:
      "Hello, this is a security notification regarding your bank account. For your safety, please review your recent banking activity and contact your bank through its official website if you notice anything suspicious. Never share your password, PIN, or one-time verification code with callers claiming to represent your bank. Always verify a caller's identity independently before taking action.",
    audioUrl: '/lab/protective.flac',
  },
  {
    id: 'otp',
    title: 'Caller requesting a verification code',
    testing: 'A caller who says they are the bank and asks you to read out a code that was sent to your phone.',
    lookFor: 'Whether the request is quoted from the transcript, and which next step is offered first.',
    script: 'Hello, this is the security team at your bank. We have detected a problem with your account. To fix it, please read me the six digit verification code we just sent to your phone.',
    audioUrl: '/lab/otp.flac',
  },
  {
    id: 'payment',
    title: 'Urgent payment request',
    testing: 'Pressure to move money quickly, backed by a threat of legal action.',
    lookFor: 'Which sentences are treated as a payment request or as pressure, and whether the advice is to verify independently before paying.',
    script: 'This is an urgent message. You owe an unpaid tax bill and you must transfer two thousand dollars to the account I will give you today, or you will face legal action.',
    audioUrl: '/lab/payment.flac',
  },
  {
    id: 'discourage',
    title: 'Caller discouraging independent verification',
    testing: 'A speaker who tells you not to check with your bank and not to tell your family.',
    lookFor: 'Whether being told not to check and being asked for secrecy are reported separately, and whether a trusted-channel step is offered.',
    script: 'Do not call your bank to check this, and do not tell anyone in your family about this call. Just stay on the line and do exactly what I say.',
    audioUrl: '/lab/discourage.flac',
  },
  {
    id: 'harmless',
    title: 'Harmless message, synthetic voice',
    testing: 'An ordinary delivery reminder spoken by a computer-generated voice.',
    lookFor: 'Whether the voice check and the scam check can disagree, and whether a synthetic-sounding voice leads to any scam advice.',
    script: 'Hi, this is an automated reminder. Your parcel will arrive on Tuesday afternoon, between two and four. Please be home to sign for it. Thank you.',
    audioUrl: '/lab/harmless.flac',
  },
  {
    id: 'ambiguous',
    title: 'Ambiguous bank notification',
    testing: 'A bank-style message that contains no explicit request.',
    lookFor: 'Whether the result stays cautious rather than calling it a scam, and what ordinary advice is offered.',
    script: 'Hello, we noticed some unusual activity on your bank account. Please contact us when you have a moment.',
    audioUrl: '/lab/ambiguous.flac',
  },
]

export class SampleLoadError extends Error {}

/**
 * Fetches a scenario's audio and wraps it as a File, so it goes through exactly the same upload and analysis path as a
 * file the user chose. A missing file on a single-page-app host is answered with the app's HTML page and a 200, so the
 * content type is checked as well as the status.
 */
export async function loadScenarioFile(scenario: Scenario, fetcher: typeof fetch = fetch): Promise<File> {
  let response: Response
  try {
    response = await fetcher(scenario.audioUrl)
  } catch {
    throw new SampleLoadError('The sample audio could not be loaded. Check your connection and try again.')
  }
  const type = response.headers.get('content-type') ?? ''
  if (!response.ok || type.includes('text/html')) throw new SampleLoadError('The sample audio is not available on this server.')
  const blob = await response.blob()
  if (blob.size === 0) throw new SampleLoadError('The sample audio file is empty.')
  return new File([blob], `${scenario.id}-sample.flac`, { type: 'audio/flac' })
}

/** Loads a scenario's audio and hands it to the normal analysis. Kept separate from the page so it can be tested. */
export async function analyzeScenario(scenario: Scenario, start: (file: File) => unknown, load: typeof loadScenarioFile = loadScenarioFile): Promise<void> {
  const file = await load(scenario)
  await start(file)
}
