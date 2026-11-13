import { DraftStatusMessage } from '../drafts/DraftStatus'
import type { DraftAccess, DraftIssue } from '../drafts/store'
import { useState, type ReactNode } from 'react'
import { GroupDashboard } from '../groups/GroupDashboard'
import { PwaUpdate } from '../PwaUpdate'
import { PwaInstall } from '../PwaInstall'
import { ConfirmationDialog } from '../ConfirmationDialog'
import { ConfirmationSuspended, useConfirmation } from '../useConfirmation'
import type { FutebolApiServices } from '../lib/api/services'
import type { GroupWorkspaceData } from '../groups/group-service'

export function FutebolWorkspace({ services, internalId, data, drafts, draftIssue, suspended, sessionActions, onLogout, onReenter, loggingOut, environment, onGroupsChanged }: {
  services: FutebolApiServices; internalId: string; onLogout: () => Promise<void>; loggingOut: boolean
  onReenter?: () => Promise<void>
  onGroupsChanged?: () => void
  drafts?: DraftAccess | null; draftIssue?: DraftIssue
  data: GroupWorkspaceData; suspended: boolean; sessionActions: ReactNode; environment: 'dev' | 'prd'
}) {
  const [pending, setPending] = useState(false)
  const { confirm, dialogProps } = useConfirmation()
  async function logout() {
    if (pending && !await confirm({ title: 'Sair sem salvar?', message: 'Sair apaga os rascunhos deste dispositivo. Uma partida enviada ainda pode aparecer no histórico.', action: 'Descartar e sair' })) return
    await onLogout()
  }
  return <div className="app-shell">
    <ConfirmationDialog {...dialogProps} />
    <header className="topbar"><a className="brand" href="#/">⚽ Futebol</a>
      {environment === 'dev' ? <span>DEV</span> : null}
      <button className="quiet-action" disabled={loggingOut} onClick={() => void logout()}>Sair</button>
    </header>
    <main className="main-content"><PwaUpdate pending={pending || suspended} />
      {sessionActions}
      {onReenter ? <button className="secondary-action" disabled={loggingOut} onClick={() => void onReenter()}>Entrar novamente com Sabará ID</button> : null}
      <div hidden={suspended} inert={suspended}>
        <ConfirmationSuspended.Provider value={suspended}>
          {draftIssue && <DraftStatusMessage status={draftIssue} />}
          <GroupDashboard drafts={drafts} key={internalId} client={services} userId={internalId} onAttemptChange={setPending} verifiedData={data} onGroupsChanged={onGroupsChanged} />
        </ConfirmationSuspended.Provider>
      </div>
    </main>
    <footer className="footer"><PwaInstall /><a className="topbar-link" href="https://account.sabara.org/" rel="noopener noreferrer" target="_blank"
      aria-disabled={pending} onClick={event => { if (pending) event.preventDefault() }}>Gerenciar minha conta Sabará</a></footer>
  </div>
}
