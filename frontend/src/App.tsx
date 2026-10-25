import { Route, Routes } from 'react-router-dom'

import { Layout } from './components/Layout'
import { AboutPage } from './pages/AboutPage'
import { DashboardPage } from './pages/DashboardPage'
import { NotFoundPage } from './pages/NotFoundPage'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
