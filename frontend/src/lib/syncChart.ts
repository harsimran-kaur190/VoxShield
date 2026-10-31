/** Layout helpers for the audio-visual sync chart, kept apart from the component so they can be unit-tested. */

export const SYNC_CHART_PAD = { top: 12, right: 64, bottom: 22, left: 8 }
const LABEL_GAP = 14

/** Baselines for the two end labels, pushed apart when the lines end close together so the labels never overlap. */
export function endLabels(mouth: number, audio: number): { mouth: number; audio: number } {
  if (Math.abs(mouth - audio) >= LABEL_GAP) return { mouth, audio }
  const middle = (mouth + audio) / 2
  const upper = Math.max(middle - LABEL_GAP / 2, SYNC_CHART_PAD.top + 8)
  // Whichever line ends higher on screen (smaller y) keeps the upper label.
  return mouth <= audio ? { mouth: upper, audio: upper + LABEL_GAP } : { audio: upper, mouth: upper + LABEL_GAP }
}
