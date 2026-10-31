import { Navigate, Route, Routes } from 'react-router-dom'

import { Layout } from './components/Layout'
import { useExtensionBridge } from './lib/extensionBridge'
import { AboutPage } from './pages/AboutPage'
import { CallDemoPage } from './pages/CallDemoPage'
import { DashboardPage } from './pages/DashboardPage'
import { DeepTruthPage } from './pages/DeepTruthPage'
import { DemoDashboardPage } from './pages/DemoDashboardPage'
import { DemoReportPage } from './pages/DemoReportPage'
import { HistoryPage } from './pages/HistoryPage'
import { HomePage } from './pages/HomePage'
import { LabPage } from './pages/LabPage'
import { LiveCallPage } from './pages/LiveCallPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ReportPage } from './pages/ReportPage'

export default function App() {
  useExtensionBridge() // results from the VoxShield Check browser extension land in History
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="analyze" element={<DashboardPage />} />
        <Route path="deeptruth" element={<DeepTruthPage />} />
        {/* Home used to live here; old links and bookmarks still land on it. */}
        <Route path="home" element={<Navigate to="/" replace />} />
        <Route path="lab" element={<LabPage />} />
        <Route path="call" element={<LiveCallPage />} />
        <Route path="call/:roomId" element={<LiveCallPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="reports/:id" element={<ReportPage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="demo/call" element={<CallDemoPage />} />
        <Route path="demo/report" element={<DemoReportPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      {/* Full-screen console with its own header, so it sits outside the site layout. */}
      <Route path="demo/analysis" element={<DemoDashboardPage />} />
    </Routes>
  )
}
