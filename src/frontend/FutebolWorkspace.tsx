import { DraftStatusMessage } from '../drafts/DraftStatus'
import { useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { GroupDashboard } from '../groups/GroupDashboard'
import { PwaUpdate } from '../PwaUpdate'
import { PwaInstall } from '../PwaInstall'
import { ConfirmationDialog } from '../ConfirmationDialog'
import { ConfirmationSuspended, useConfirmation } from '../useConfirmation'
import type { Workspace, WorkspaceAccess } from './futebol-session'
import { useWorkspaceScroll } from './workspace-scroll'

export function FutebolWorkspace({ workspace, access, sessionActions, onLogout, onReenter, loggingOut, environment, onGroupsChanged }: {
  workspace: Workspace | null; access: WorkspaceAccess; onLogout: () => Promise<void>; loggingOut: boolean
  onReenter?: () => Promise<void>
  onGroupsChanged?: () => void
  sessionActions: ReactNode; environment: 'dev' | 'prd'
}) {
  const suspended = access !== 'active'
  const blocked = access === 'blocked'
  const [pending, setPending] = useState(false)
  const content = useRef<HTMLDivElement>(null)
  const path = useLocation().pathname
  const height = useWorkspaceScroll(content, !blocked, workspace?.internalId, workspace?.data, path)
  const { confirm, dialogProps } = useConfirmation()
  async function logout() {
    if ((pending || !workspace) && !await confirm({ title: 'Sair sem salvar?', message: 'Sair apaga os rascunhos deste dispositivo. Uma partida enviada ainda pode aparecer no histórico.', action: 'Descartar e sair' })) return
    await onLogout()
  }
  return <div className="app-shell">
    <ConfirmationDialog {...dialogProps} />
    <header className="topbar"><a className="brand" href="#/">⚽ Futebol</a>
      {environment === 'dev' ? <span>DEV</span> : null}
      <button className="quiet-action" disabled={loggingOut} onClick={() => void logout()}>Sair</button>
    </header>
    <main className="main-content"><PwaUpdate pending={pending || suspended} />
      {sessionActions ? <div className="workspace-session-notice">
        {sessionActions}{onReenter ? <button className="secondary-action" disabled={loggingOut} onClick={() => void onReenter()}>Entrar novamente com Sabará ID</button> : null}
      </div> : null}
      <div style={blocked ? { minHeight: height } : undefined}>
        <div ref={content} hidden={blocked} inert={suspended} data-workspace-content>
          <ConfirmationSuspended.Provider value={suspended}>
            {workspace?.draftIssue && <DraftStatusMessage status={workspace.draftIssue} />}
            {workspace && <GroupDashboard drafts={workspace.drafts} key={workspace.internalId} client={workspace.services} userId={workspace.internalId} onAttemptChange={setPending} verifiedData={workspace.data} onGroupsChanged={onGroupsChanged} />}
          </ConfirmationSuspended.Provider>
        </div>
      </div>
    </main>
    <footer className="footer"><PwaInstall /><a className="topbar-link" href="https://account.sabara.org/" rel="noopener noreferrer" target="_blank"
      aria-disabled={pending} onClick={event => { if (pending) event.preventDefault() }}>Gerenciar minha conta Sabará</a></footer>
  </div>
}
