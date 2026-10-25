import type { Limits } from './api'
import type { RecorderLimits, RecordingResult } from './recorderSession'

/** 16 kHz, 16-bit, mono WAV: 32,000 bytes per second. */
const WAV_BYTES_PER_SECOND = 32_000

/** The longest recording that is within both the duration limit and the upload size limit. */
export function recorderLimits(limits: Limits | null): RecorderLimits {
  const maxDuration = limits?.max_duration_seconds ?? 600
  const maxBytes = (limits?.max_upload_mb ?? 25) * 1024 * 1024
  return {
    maxSeconds: Math.floor(Math.min(maxDuration, (maxBytes - 1024) / WAV_BYTES_PER_SECOND)),
    minSeconds: limits?.min_duration_seconds ?? 1,
  }
}

export function recordingFileName(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `recording-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.wav`
}

/** The recording as an ordinary upload, so it goes through exactly the same endpoint as a chosen file. */
export function recordingToFile(result: Pick<RecordingResult, 'blob'>, date = new Date()): File {
  return new File([result.blob], recordingFileName(date), { type: 'audio/wav' })
}
