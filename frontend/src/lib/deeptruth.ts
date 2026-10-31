/**
 * DeepTruth API client and types. Mirrors backend/app/deeptruth/schemas.py: every detection module returns the same
 * shape (score, reliability, evidence, limitations), and the report fuses them into one verdict.
 */
import { ApiError } from './api'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'

export type Modality = 'image' | 'audio' | 'video_frames' | 'lipsync' | 'video_temporal'
export type MediaKind = 'image' | 'audio' | 'video'
export type Verdict = 'Likely manipulated' | 'No manipulation detected' | 'Inconclusive' | 'Mixed signals'

export interface TimelineWindow {
  start_seconds: number
  end_seconds: number
  score: number
  flagged: boolean
}

export interface SpectrogramData {
  hop_seconds: number
  duration_seconds: number
  freq_max_hz: number
  bins: number
  /** Rows are time steps, columns are frequency bins (low to high), values 0-255. */
  values: number[][]
  flagged: TimelineWindow[]
}

export interface FaceBox {
  x: number
  y: number
  w: number
  h: number
}

export interface HeatmapData {
  /** Rows are image rows (top to bottom), values 0-255, at most 96 cells on the longest side. */
  values: number[][]
  faces: FaceBox[]
  stats: Record<string, number>
  note: string
}

/** Two time series on one 0-1 scale, from the audio-visual sync check. `mouth` is null where no face was found. */
export interface SyncSeries {
  times: number[]
  mouth: (number | null)[]
  audio: number[]
}

/** Scored windows (voice, video frames, frame consistency) or, for the sync check, two continuous series. */
export interface TimelineData {
  windows?: TimelineWindow[]
  cutoff?: number
  series?: SyncSeries
  duration_seconds: number | null
}

export type Evidence =
  | { type: 'timeline'; label: string; data: TimelineData }
  | { type: 'spectrogram'; label: string; data: SpectrogramData }
  | { type: 'heatmap'; label: string; data: HeatmapData }
  | { type: 'metadata'; label: string; data: Record<string, unknown> }

export interface ModuleResult {
  modality: Modality
  score: number
  reliability: number
  evidence: Evidence[]
  limitations: string[]
  status: 'ok' | 'unavailable'
  summary: string
  models: string[]
  error: string | null
  /** Plain-language description of what the module looks at. Absent in reports from older servers. */
  checks?: string
  /** "measured": accuracy was checked on labelled data. "heuristic": rules set by reasoning. */
  basis?: 'measured' | 'heuristic' | null
  basis_note?: string
}

export interface MediaInfo {
  filename: string
  kind: MediaKind
  format: string
  size_bytes: number
  duration_seconds: number | null
  width: number | null
  height: number | null
  has_audio: boolean | null
  has_video: boolean | null
}

export interface DeepTruthReport {
  verdict: Verdict
  /** One sentence on how the verdict was reached. */
  verdict_reason: string
  /** Modules that pointed firmly in opposite directions (one strong signal may still have decided). */
  disagreement: string[] | null
  /** The module whose strong reading decided the verdict alone, when that rule applied. */
  decided_by?: Modality | null
  /** The headline number: the deciding module's score, or the weighted average when no single module decided. */
  manipulation_likelihood: number
  /** Reliability-weighted average of every module's score. */
  weighted_average?: number
  confidence: number
  modules: ModuleResult[]
  limitations: string[]
  media: MediaInfo
  status: 'complete' | 'partial' | 'failed'
  timings_seconds: Record<string, number>
  notice: string
}

export interface DeepTruthLimits {
  max_upload_mb: number
  max_duration_seconds: number
  extensions: Record<MediaKind, string[]>
  supported_kinds: MediaKind[]
}

async function parseError(response: Response): Promise<ApiError> {
  let code = 'http_error'
  let message = `The server responded with an error (${response.status}).`
  try {
    const body = await response.json()
    if (body?.detail?.message) {
      code = body.detail.code ?? code
      message = body.detail.message
    }
  } catch {
    // keep the generic message
  }
  return new ApiError(code, message)
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, init)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError('network', 'Cannot reach the DeepTruth server. Check that the backend is running.')
  }
  if (!response.ok) throw await parseError(response)
  return response
}

export const getDeepTruthLimits = (signal?: AbortSignal) => send('/deeptruth/limits', { signal }).then((r) => r.json() as Promise<DeepTruthLimits>)

/** Uploads any supported media file. The server decides from the bytes whether it is an image, audio or video. */
export async function analyzeMedia(file: File, signal?: AbortSignal): Promise<DeepTruthReport> {
  const form = new FormData()
  form.append('file', file)
  const response = await send('/deeptruth/analyze', { method: 'POST', body: form, signal })
  return response.json() as Promise<DeepTruthReport>
}

/** A rough guess from the browser's MIME type, only to label the file while it uploads. The server's answer is final. */
export function guessKind(file: File): MediaKind | null {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  return null
}

export const verdictTone = (verdict: Verdict): 'critical' | 'success' | 'warning' | 'neutral' =>
  verdict === 'Likely manipulated' ? 'critical' : verdict === 'No manipulation detected' ? 'success' : verdict === 'Mixed signals' ? 'warning' : 'neutral'

export const MODALITY_LABELS: Record<Modality, string> = {
  image: 'Image forensics',
  audio: 'Voice authenticity',
  video_frames: 'Video frames',
  lipsync: 'Audio-visual sync consistency',
  video_temporal: 'Frame-to-frame consistency',
}

/** The verdict band a likelihood falls in, matching the backend's 0.4 / 0.6 cut-offs. */
export function bandFor(likelihood: number): { label: string; tone: 'success' | 'neutral' | 'critical' } {
  if (likelihood >= 0.6) return { label: 'Manipulated band', tone: 'critical' }
  if (likelihood <= 0.4) return { label: 'Authentic band', tone: 'success' }
  return { label: 'Inconclusive band', tone: 'neutral' }
}

/** Every timeline evidence item across modules, for the shared time axis. */
export function timelineRows(report: DeepTruthReport): { module: Modality; label: string; windows: TimelineWindow[]; duration: number }[] {
  const rows: { module: Modality; label: string; windows: TimelineWindow[]; duration: number }[] = []
  for (const module of report.modules) {
    for (const item of module.evidence) {
      if (item.type !== 'timeline' || !item.data.windows) continue
      const last = item.data.windows.at(-1)
      const duration = item.data.duration_seconds ?? report.media.duration_seconds ?? last?.end_seconds ?? 0
      rows.push({ module: module.modality, label: item.label, windows: item.data.windows, duration })
    }
  }
  return rows
}

/** Each module's share of the weighted average: its reliability over the total reliability of all modules. */
export function weightShares(modules: ModuleResult[]): Map<Modality, number> {
  const total = modules.reduce((sum, m) => sum + m.reliability, 0)
  return new Map(modules.map((m) => [m.modality, total > 0 ? m.reliability / total : 0]))
}
