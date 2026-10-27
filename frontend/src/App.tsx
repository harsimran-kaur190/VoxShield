import { Route, Routes } from 'react-router-dom'

import { Layout } from './components/Layout'
import { AboutPage } from './pages/AboutPage'
import { CallDemoPage } from './pages/CallDemoPage'
import { DashboardPage } from './pages/DashboardPage'
import { DemoDashboardPage } from './pages/DemoDashboardPage'
import { DemoReportPage } from './pages/DemoReportPage'
import { HistoryPage } from './pages/HistoryPage'
import { HomePage } from './pages/HomePage'
import { LabPage } from './pages/LabPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ReportPage } from './pages/ReportPage'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="home" element={<HomePage />} />
        <Route path="lab" element={<LabPage />} />
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
