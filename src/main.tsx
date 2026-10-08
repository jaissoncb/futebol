import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { bootstrapApplication } from './bootstrap/auth-pkce'
import './styles.css'

async function start() {
  const bootstrap = await bootstrapApplication(new URL(window.location.href))
  const root = document.getElementById('root')

  if (!root) {
    throw new Error('Elemento raiz da aplicação não encontrado.')
  }

  createRoot(root).render(
    <StrictMode>
      <App bootstrap={bootstrap} />
    </StrictMode>,
  )
}

void start()
