import { useState } from 'react'
import { GroupDashboard } from '../groups/GroupDashboard'
import { PwaUpdate } from '../PwaUpdate'
import type { FutebolApiServices } from '../lib/api/services'
import { accountPortalUrl } from './kinde-test-config'

export function DevWorkspace({ services, internalId, onLogout, loggingOut, sessionNotice }: {
  services: FutebolApiServices; internalId: string; onLogout: () => Promise<void>; loggingOut: boolean; sessionNotice?: string | null
}) {
  const [pending, setPending] = useState(false)
  return <div className="app-shell">
    <header className="topbar"><a className="brand" href="#/">⚽ Futebol</a>
      <span>DEV</span><button className="quiet-action" disabled={loggingOut} onClick={() => {
        if (!pending || window.confirm('Sair descarta a partida e os dados ainda não salvos. Sair agora?')) void onLogout()
      }}>Sair</button>
    </header>
    <main className="main-content"><PwaUpdate pending={pending} />
      {sessionNotice ? <p role="status">{sessionNotice}</p> : null}
      <GroupDashboard key={internalId} client={services} userId={internalId} onAttemptChange={setPending} />
    </main>
    <footer className="footer"><a href={accountPortalUrl} rel="noopener noreferrer" target="_blank"
      aria-disabled={pending} onClick={event => { if (pending) event.preventDefault() }}>Gerenciar minha conta Sabará</a></footer>
  </div>
}
