import { Navigate } from 'react-router-dom'

import { useHistory } from '../hooks/useHistory'
import { reportPath } from '../lib/history'
import { ReportMissing } from './ReportPage'

/** The latest simulation's report. Each run also has its own address under /reports. */
export function DemoReportPage() {
  const latest = useHistory().find((entry) => entry.kind === 'simulation')
  if (latest) return <Navigate to={reportPath(latest.id)} replace />
  return (
    <ReportMissing
      title="No simulated report yet"
      description="Run the simulated call to the end, or end it early, and its report will appear here. Simulated reports are kept only in this browser tab’s memory."
    />
  )
}
