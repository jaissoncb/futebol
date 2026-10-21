import { createRoot } from 'react-dom/client'
import { FutebolRoot } from './frontend/FutebolRoot'
import { configureKindeSession } from './auth/kinde-session'
import { cleanKindeCallback, readKindeCallbackStatus } from './bootstrap/kinde-return'
import { assertFutebolLocation } from './config/futebol-environment'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Elemento raiz não encontrado.')
try {
  const config = __FUTEBOL_FRONTEND_CONFIG__
  const url = new URL(window.location.href)
  assertFutebolLocation(url, config)
  const session = configureKindeSession(config.environment)
  const initialFailed = readKindeCallbackStatus(url) === 'reject'
  if (initialFailed) {
    session.transaction.destroySession()
    window.history.replaceState({}, '', cleanKindeCallback(url, '#/', config.appOrigin))
  }
  createRoot(root).render(<FutebolRoot config={config} session={session} initialFailed={initialFailed} />)
} catch {
  root.textContent = 'Não foi possível iniciar o Futebol nesta origem. Abra o endereço configurado para este ambiente.'
}
