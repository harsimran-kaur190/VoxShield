import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import '@fontsource-variable/fraunces/wght.css'
import '@fontsource-variable/fraunces/wght-italic.css'
import '@fontsource-variable/inter/index.css'
import '@fontsource-variable/jetbrains-mono/index.css'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
