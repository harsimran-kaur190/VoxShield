import type { SimulationStatus } from './liveSimulation'
import type { AnalysisReport } from './types'

/**
 * Completed analyses and simulations from this browser tab, so their reports can be reopened.
 *
 * Kept in memory only: nothing is written to localStorage, IndexedDB or the server, so a refresh or closing the tab
 * clears it. The backend keeps no reports and returns no analysis ID, so the IDs here are assigned by the browser.
 * Real reports and simulations are stored as different kinds and never mixed.
 */

export const HISTORY_LIMIT = 25

export const HISTORY_NOTICE =
  'History is kept in this browser tab’s memory only. Nothing is saved to the server or to browser storage, so refreshing or closing the tab clears it. Audio is not kept.'

export const ID_NOTE = 'Assigned by your browser for this session. The backend does not store reports or issue IDs.'

interface BaseEntry {
  id: string
  /** When the analysis or simulation completed, as an ISO string. */
  completedAt: string
}

export interface AnalysisEntry extends BaseEntry {
  kind: 'analysis'
  /** Where the audio came from: the user's own file or recording, or a Scenario Lab sample. */
  source: 'upload' | 'lab'
  /** A Scenario Lab sample's title; otherwise the file name. */
  title: string
  /** The backend's response, exactly as returned. */
  report: AnalysisReport
}

export interface SimulationEntry extends BaseEntry {
  kind: 'simulation'
  scenarioId: string
  title: string
  /** How the simulation stopped, and how much of the script had played. */
  status: Extract<SimulationStatus, 'finished' | 'ended'>
  elapsed: number
  duration: number
}

export type HistoryEntry = AnalysisEntry | SimulationEntry
type NewEntry = Omit<AnalysisEntry, 'id' | 'completedAt'> | Omit<SimulationEntry, 'id' | 'completedAt'>

let entries: HistoryEntry[] = []
const listeners = new Set<() => void>()
let counter = 0

function newId(kind: HistoryEntry['kind']): string {
  const prefix = kind === 'analysis' ? 'AN' : 'SIM'
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : `${Date.now().toString(36)}${(counter++).toString(36)}`
  return `${prefix}-${random.toUpperCase()}`
}

function emit() {
  listeners.forEach((listener) => listener())
}

/** Adds an entry, newest first, and returns it. The oldest entries are dropped past HISTORY_LIMIT. */
export function addEntry(entry: NewEntry, now: Date = new Date()): HistoryEntry {
  const saved = { ...entry, id: newId(entry.kind), completedAt: now.toISOString() } as HistoryEntry
  entries = [saved, ...entries].slice(0, HISTORY_LIMIT)
  emit()
  return saved
}

export const getEntries = (): HistoryEntry[] => entries
export const getEntry = (id: string | undefined): HistoryEntry | null => entries.find((entry) => entry.id === id) ?? null
export const latestSimulation = (): SimulationEntry | null => entries.find((entry): entry is SimulationEntry => entry.kind === 'simulation') ?? null

export function clearHistory() {
  entries = []
  emit()
}

export function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const reportPath = (id: string) => `/reports/${id}`
export const HISTORY_PATH = '/history'

export const formatCompletedAt = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
