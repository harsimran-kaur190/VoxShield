import { FileQuestion, History } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { DeepTruthResult } from '../components/deeptruth/DeepTruthResult'
import { AnalysisReportDocument } from '../components/report/AnalysisReportDocument'
import { LiveCallReportDocument } from '../components/report/LiveCallReportDocument'
import { SimulationReportDocument } from '../components/report/SimulationReportDocument'
import { EmptyState } from '../components/ui/Feedback'
import { buttonClass } from '../components/ui/styles'
import { useHistory } from '../hooks/useHistory'
import { DEMO_SCENARIOS } from '../lib/demoScenario'
import { getEntry, HISTORY_NOTICE, HISTORY_PATH } from '../lib/history'

/** One report from this tab's history, real or simulated, chosen by its ID in the URL. */
export function ReportPage() {
  const { id } = useParams()
  useHistory() // re-render when History changes
  const entry = getEntry(id)
  const navigate = useNavigate()

  // The file itself is never kept, so an image report reopens without its picture under the heatmaps.
  if (entry?.kind === 'deeptruth') return <DeepTruthResult report={entry.report} file={null} onReset={() => navigate('/deeptruth')} />
  if (entry?.kind === 'analysis') return <AnalysisReportDocument entry={entry} />
  if (entry?.kind === 'live-call') return <LiveCallReportDocument entry={entry} />
  const scenario = entry?.kind === 'simulation' ? DEMO_SCENARIOS[entry.scenarioId] : undefined
  if (entry?.kind === 'simulation' && scenario) return <SimulationReportDocument entry={entry} scenario={scenario} />

  return <ReportMissing />
}

export function ReportMissing({ title = 'This report is not available', description }: { title?: string; description?: string }) {
  return (
    <div className="mx-auto max-w-xl py-8">
      <EmptyState
        icon={FileQuestion}
        title={title}
        description={description ?? `Reports exist only for analyses and simulations completed in this browser tab. ${HISTORY_NOTICE}`}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Link to={HISTORY_PATH} className={buttonClass({ variant: 'secondary' })}>
              <History className="size-4" aria-hidden />
              Open History
            </Link>
            <Link to="/analyze" className={buttonClass()}>
              Analyze audio
            </Link>
          </div>
        }
      />
    </div>
  )
}
