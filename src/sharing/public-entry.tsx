import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles.css'
import { PublicDrawPage } from './PublicDrawPage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PublicDrawPage apiBase={__FUTEBOL_PUBLIC_API_BASE__} address={new URL(window.location.href)} />
  </StrictMode>,
)
