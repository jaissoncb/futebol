import { useState } from 'react'
import { GroupDashboard } from '../groups/GroupDashboard'
import { PwaUpdate } from '../PwaUpdate'
import { PwaInstall } from '../PwaInstall'
import { ConfirmationDialog } from '../ConfirmationDialog'
import { useConfirmation } from '../useConfirmation'
import type { FutebolApiServices } from '../lib/api/services'

export function FutebolWorkspace({ services, internalId, onLogout, loggingOut, sessionNotice, environment }: {
  services: FutebolApiServices; internalId: string; onLogout: () => Promise<void>; loggingOut: boolean
  sessionNotice: string | null; environment: 'dev' | 'prd'
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
      {environment === 'dev' ? <span>DEV</span> : null}
      <button className="quiet-action" disabled={loggingOut} onClick={() => void logout()}>Sair</button>
    </header>
    <main className="main-content"><PwaUpdate pending={pending} />
      {sessionNotice ? <p role="status">{sessionNotice}</p> : null}
      <GroupDashboard key={internalId} client={services} userId={internalId} onAttemptChange={setPending} />
    </main>
    <footer className="footer"><PwaInstall /><a className="topbar-link" href="https://account.sabara.org/" rel="noopener noreferrer" target="_blank"
      aria-disabled={pending} onClick={event => { if (pending) event.preventDefault() }}>Gerenciar minha conta Sabará</a></footer>
  </div>
}
