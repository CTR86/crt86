import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/press-start-2p'
import '@fontsource/vt323'
import './styles/theme.css'
import './styles/base.css'
import './styles/crt.css'
import './styles/components.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
