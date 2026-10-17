import { createRoot } from 'react-dom/client'
import { KindeDevRoot } from './KindeDevRoot'
import { configureKindeSession } from '../auth/kinde-session'
import { assertKindeDevLocation } from './kinde-test-config'
import { cleanKindeCallback, readKindeCallbackStatus } from '../bootstrap/kinde-return'
import '../styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Elemento raiz não encontrado.')
try {
  const url = new URL(window.location.href)
  assertKindeDevLocation(url)
  const session = configureKindeSession()
  const initialFailed = readKindeCallbackStatus(url) === 'reject'
  if (initialFailed) {
    session.transaction.destroySession()
    window.history.replaceState({}, '', cleanKindeCallback(url, '#/'))
  }
  createRoot(root).render(<KindeDevRoot session={session} initialFailed={initialFailed} />)
} catch {
  // No OAuth query/configuration values enter the error view.
  root.textContent = 'Abra o Futebol DEV em http://localhost:5173/ para continuar.'
}
