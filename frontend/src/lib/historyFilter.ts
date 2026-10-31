import { entrySource, type HistoryEntry, type HistorySource } from './history'

/** Source filter. 'all' includes simulations and live calls, which have no source. */
export const SOURCE_FILTERS: { value: HistorySource | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'upload', label: 'Your uploads' },
  { value: 'lab', label: 'Lab samples' },
  { value: 'extension', label: 'Browser extension' },
]
export const SOURCE_LABEL: Record<HistorySource, string> = { upload: 'Real analysis', lab: 'Real analysis · Lab sample', extension: 'Real analysis · Browser extension' }

export const filterBySource = (entries: HistoryEntry[], source: HistorySource | 'all') => (source === 'all' ? entries : entries.filter((entry) => entrySource(entry) === source))
