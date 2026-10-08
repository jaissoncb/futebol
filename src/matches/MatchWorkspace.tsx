import { useState } from 'react'
import type { FutebolSupabaseClient } from '../lib/supabase/client'
import type { GroupWithRole, Player } from '../groups/group-service'
import { GameFlow } from '../draw/GameFlow'
import { MatchHistory } from './MatchHistory'

/** Keep the draft mounted when history opens; a saved result is immutable. */
export function MatchWorkspace({ client, group, players, onAttemptChange }: { client: FutebolSupabaseClient | null; group: GroupWithRole; players: Player[]; onAttemptChange?: (pending: boolean) => void }) {
  const [open, setOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [session, setSession] = useState(0)
  const [saved, setSaved] = useState(false)
  return <>
    <GameFlow key={session} client={client} group={group} players={players} onAttemptChange={onAttemptChange} onSaved={(id) => { setSaved(true); setSelectedId(id); setOpen(true) }} />
    {saved ? <button className="quiet-action" type="button" onClick={() => { setSession((n) => n + 1); setSaved(false) }}>Criar outra partida</button> : null}
    <section className="panel match-history" aria-label="Histórico de partidas">
      <div className="section-title-row"><h2>Histórico de partidas</h2><button className="quiet-action" type="button" onClick={() => { setOpen(!open); if (open) setSelectedId(null) }}>{open ? 'Fechar histórico' : 'Abrir histórico'}</button></div>
      {open ? <MatchHistory client={client} group={group} selectedId={selectedId} onSelect={setSelectedId} /> : null}
    </section>
  </>
}
