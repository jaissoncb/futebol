import { useState, type ReactNode } from 'react'
import { GroupDashboard } from '../groups/GroupDashboard'
import { PwaUpdate } from '../PwaUpdate'
import { ConfirmationDialog } from '../ConfirmationDialog'
import { useConfirmation } from '../useConfirmation'
import type { FutebolApiServices } from '../lib/api/services'
import { accountPortalUrl } from './kinde-test-config'

export function DevWorkspace({ services, internalId, onLogout, loggingOut, sessionNotice, diagnostics }: {
  services: FutebolApiServices; internalId: string; onLogout: () => Promise<void>; loggingOut: boolean; sessionNotice?: string | null; diagnostics?: ReactNode
}) {
  const [pending, setPending] = useState(false)
  const { confirm, dialogProps } = useConfirmation()
  async function logout() {
    if (pending && !await confirm({ title: 'Sair sem salvar?', message: 'Sua partida tem alterações não salvas. Ao sair, este rascunho será descartado.', action: 'Descartar e sair' })) return
    await onLogout()
  }
  return <div className="app-shell">
    <ConfirmationDialog {...dialogProps} />
    <header className="topbar"><a className="brand" href="#/">⚽ Futebol</a>
      <span>DEV</span><button className="quiet-action" disabled={loggingOut} onClick={() => void logout()}>Sair</button>
    </header>
    <main className="main-content"><PwaUpdate pending={pending} />
      {sessionNotice ? <p role="status">{sessionNotice}</p> : null}
      {diagnostics}
      <GroupDashboard key={internalId} client={services} userId={internalId} onAttemptChange={setPending} />
    </main>
    <footer className="footer"><a href={accountPortalUrl} rel="noopener noreferrer" target="_blank"
      aria-disabled={pending} onClick={event => { if (pending) event.preventDefault() }}>Gerenciar minha conta Sabará</a></footer>
  </div>
}
