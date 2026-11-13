import { useState, type ReactNode } from 'react'
import { GroupDashboard } from '../groups/GroupDashboard'
import { PwaUpdate } from '../PwaUpdate'
import { PwaInstall } from '../PwaInstall'
import { ConfirmationDialog } from '../ConfirmationDialog'
import { ConfirmationSuspended, useConfirmation } from '../useConfirmation'
import type { FutebolApiServices } from '../lib/api/services'
import type { GroupWorkspaceData } from '../groups/group-service'

export function FutebolWorkspace({ services, internalId, data, suspended, sessionActions, onLogout, onReenter, loggingOut, environment }: {
  services: FutebolApiServices; internalId: string; onLogout: () => Promise<void>; loggingOut: boolean
  onReenter?: () => Promise<void>
  data: GroupWorkspaceData; suspended: boolean; sessionActions: ReactNode; environment: 'dev' | 'prd'
}) {
  const [pending, setPending] = useState(false)
  const { confirm, dialogProps } = useConfirmation()
  async function logout() {
    if (pending && !await confirm({ title: 'Sair sem salvar?', message: 'Sua partida tem alterações não salvas. Ao sair, este rascunho será descartado.', action: 'Descartar e sair' })) return
    await onLogout()
  }
  async function reenter() {
    if (pending && !await confirm({ title: 'Entrar novamente?', message: 'Entrar com o Sabará ID recarrega a página e descarta o rascunho desta sessão.', action: 'Descartar e entrar' })) return
    await onReenter?.()
  }
  return <div className="app-shell">
    <ConfirmationDialog {...dialogProps} />
    <header className="topbar"><a className="brand" href="#/">⚽ Futebol</a>
      {environment === 'dev' ? <span>DEV</span> : null}
      <button className="quiet-action" disabled={loggingOut} onClick={() => void logout()}>Sair</button>
    </header>
    <main className="main-content"><PwaUpdate pending={pending || suspended} />
      {sessionActions}
      {onReenter ? <button className="secondary-action" disabled={loggingOut} onClick={() => void reenter()}>Entrar novamente com Sabará ID</button> : null}
      <div hidden={suspended} inert={suspended}>
        <ConfirmationSuspended.Provider value={suspended}>
          <GroupDashboard key={internalId} client={services} userId={internalId} onAttemptChange={setPending} verifiedData={data} />
        </ConfirmationSuspended.Provider>
      </div>
    </main>
    <footer className="footer"><PwaInstall /><a className="topbar-link" href="https://account.sabara.org/" rel="noopener noreferrer" target="_blank"
      aria-disabled={pending} onClick={event => { if (pending) event.preventDefault() }}>Gerenciar minha conta Sabará</a></footer>
  </div>
}
