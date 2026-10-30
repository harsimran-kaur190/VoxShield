import type { LanguageChoice } from './languages'
import type { AnalysisReport, ModelsResponse, Stage, StageState } from './types'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'

export interface Health {
  status: string
  service: string
  version: string
}

export interface Limits {
  max_upload_mb: number
  min_duration_seconds: number
  max_duration_seconds: number
  allowed_extensions: string[]
  /** Absent on servers from before language selection. */
  languages?: { code: string; name: string; scam_detection_validated: boolean | null }[]
}

export class ApiError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, init)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError('network', 'Cannot reach the VoxShield server. Check that the backend is running.')
  }
  if (!response.ok) {
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
    throw new ApiError(code, message)
  }
  return response
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return (await send(path, init)).json() as Promise<T>
}

export const getHealth = (signal?: AbortSignal) => request<Health>('/health', { signal })
export const getLimits = (signal?: AbortSignal) => request<Limits>('/limits', { signal })
export const getModels = (signal?: AbortSignal) => request<ModelsResponse>('/models', { signal })

type StreamEvent =
  | { type: 'stage'; stage: Stage; state: 'running' | 'done' | 'failed' }
  | { type: 'report'; report: AnalysisReport }
  | { type: 'error'; message: string }

export async function analyzeAudio(
  file: File,
  onStage: (stage: Stage, state: StageState) => void,
  signal?: AbortSignal,
  language: LanguageChoice = 'auto',
): Promise<AnalysisReport> {
  const form = new FormData()
  form.append('file', file)
  // Auto-detect sends nothing, which is exactly what clients did before language selection existed.
  if (language !== 'auto') form.append('language', language)
  const response = await send('/analysis/stream', { method: 'POST', body: form, signal })
  if (!response.body) throw new ApiError('no_stream', 'The server did not return a readable response.')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let report: AnalysisReport | null = null

  const handle = (line: string) => {
    if (!line.trim()) return
    const event = JSON.parse(line) as StreamEvent
    if (event.type === 'stage') onStage(event.stage, event.state)
    else if (event.type === 'report') report = event.report
    else throw new ApiError('analysis_stopped', event.message)
  }

  for (;;) {
    const { value, done } = await reader.read()
    if (value) buffer += decoder.decode(value, { stream: !done })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    lines.forEach(handle)
    if (done) break
  }
  handle(buffer)
  if (!report) throw new ApiError('no_report', 'The analysis ended without a result.')
  return report
}

export interface CallRoom {
  room_id: string
  max_participants: number
  idle_expiry_seconds: number
}

/** Creates a private two-person call room. The room ID is the invitation, so it is shared only with the other person. */
export const createCallRoom = (signal?: AbortSignal) => request<CallRoom>('/calls', { method: 'POST', signal })

/** The call's WebSocket address, next to the API: same host in development (Vite proxies it), wss:// for an https API. */
export function callSocketUrl(roomId: string, base: string = API_BASE, page: string = typeof window === 'undefined' ? 'http://localhost/' : window.location.href): string {
  const url = new URL(base, page)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = `${url.pathname.replace(/\/$/, '')}/calls/${encodeURIComponent(roomId)}/ws`
  url.search = ''
  url.hash = ''
  return url.toString()
}
