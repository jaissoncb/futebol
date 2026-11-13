import { DraftReadError, DraftStatusMessage } from '../drafts/DraftStatus'
import { isMatchDraft } from '../drafts/models'
import type { DraftScope } from '../drafts/store'
import { useDraftRecord } from '../drafts/use-draft'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FutebolDataClient } from '../lib/data-client'
import type { GroupWithRole, Player } from '../groups/group-service'
import { GameFlow } from '../draw/GameFlow'
import { MatchHistory } from './MatchHistory'
import { loadMatchHistory, loadSavedMatch } from './match-service'
import { repeatMatch, type RepeatDraft } from './repeat-match'
import { ConfirmationDialog } from '../ConfirmationDialog'
import { useConfirmation } from '../useConfirmation'

/** Keep the draft mounted when history opens; a saved result is immutable. */
export function MatchWorkspace({ client, group, players, onAttemptChange, onDraftChange, gameId, historyId, authorizationVersion, scope, requireDurable }: { client: FutebolDataClient | null; group: GroupWithRole; players: Player[]; onAttemptChange?: (pending: boolean) => void; onDraftChange?: (dirty: boolean) => void; gameId?: string; historyId?: string; authorizationVersion?: number; scope?: DraftScope | null; requireDurable?: boolean }) {
  const { confirm, dialogProps } = useConfirmation()
  const { record, status, reload, discardCorrupt } = useDraftRecord(scope, 'match', isMatchDraft)
  const [open, setOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [session, setSession] = useState(0)
  const [saved, setSaved] = useState(false)
  const [draft, setDraft] = useState<RepeatDraft>()
  const [repeating, setRepeating] = useState(false)
  const [attemptPending, setAttemptPending] = useState(false)
  const [repeatNotice, setRepeatNotice] = useState<string | null>(null)
  const [repeatError, setRepeatError] = useState<string | null>(null)
  const dirty = useRef(false)
  const pending = useRef(false)
  const loading = useRef(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const draftChanged = useCallback((value: boolean) => { dirty.current = value; onDraftChange?.(value) }, [onDraftChange])
  const attemptChanged = useCallback((value: boolean) => { pending.current = value; setAttemptPending(value); onAttemptChange?.(value) }, [onAttemptChange])
  const matchSaved = useCallback((id: string) => {
    setRepeatNotice(null); setSaved(true); setSelectedId(id); setOpen(true)
  }, [])
  async function repeatLast() {
    if (!client || record.state !== 'ready' || loading.current || pending.current) return
    loading.current = true; setRepeating(true); setRepeatError(null)
    try {
      const rows = await loadMatchHistory(client, group.id, 0)
      if (!alive.current) return
      if (!rows[0]) { setRepeatNotice('Ainda não há uma partida salva neste grupo para repetir.'); return }
      const last = await loadSavedMatch(client, group.id, rows[0].id)
      if (!alive.current || pending.current) return
      const next = repeatMatch(last, group.id, players)
      if (dirty.current && !await confirm({ title: 'Substituir o rascunho?', message: 'Há alterações não salvas. A última partida será usada para preparar um novo rascunho.', action: 'Descartar e repetir partida' })) return
      if (record.writer && !await record.writer.commit(null)) return
      setDraft(next); setSession(n => n + 1); setSaved(false); setOpen(false); setSelectedId(null)
      setRepeatNotice(`Novo rascunho baseado na última partida do histórico. Revise os participantes e toque em Sortear times.${next.unavailable ? ` ${next.unavailable} jogador(es) indisponível(is) não foram selecionados.` : ''}`)
    } catch { if (alive.current) setRepeatError('Não foi possível preparar a última partida. Seu rascunho foi mantido. Tente novamente.') }
    finally { loading.current = false; if (alive.current) setRepeating(false) }
  }
  return <>
    <ConfirmationDialog {...dialogProps} />
    <section id={gameId} tabIndex={-1} className="game-workspace" aria-label="Partidas do grupo">
      {group.role !== 'member' ? <div className="repeat-game"><button className="quiet-action" disabled={record.state !== 'ready' || repeating || attemptPending} onClick={() => void repeatLast()}>{repeating ? 'Preparando partida…' : 'Repetir última partida'}</button><small>Cria um rascunho com a data de hoje. O histórico permanece intacto.</small></div> : null}
      {repeatNotice ? <p className="notice" role="status">{repeatNotice}</p> : null}
      {repeatError ? <p className="form-status" role="alert">{repeatError}</p> : null}
      {group.role !== 'member' && <>
        <DraftStatusMessage status={status} onReload={() => { setDraft(undefined); setSession(0); setSaved(false); attemptChanged(false); draftChanged(false); reload() }} />
        {record.state === 'loading' ? <p role="status">Abrindo rascunho da partida…</p>
          : record.state === 'error' ? <DraftReadError issue={record.issue} onRetry={reload} onDiscard={() => void discardCorrupt()} />
          : <GameFlow key={session} client={client} group={group} players={players}
            initialDraft={draft} restored={session === 0 ? record.initial : null} writer={record.writer}
            requireDurable={requireDurable} draftUserId={scope?.userId}
            onDiscard={record.writer ? () => { setDraft(undefined); setSession(n => n + 1) } : undefined}
            onAttemptChange={attemptChanged} onDraftChange={draftChanged} authorizationVersion={authorizationVersion}
            onSaved={matchSaved} />}
      </>}
      {saved ? <button className="quiet-action" type="button" onClick={() => { setDraft(undefined); setRepeatNotice(null); setSession(n => n + 1); setSaved(false) }}>Criar outra partida</button> : null}
    </section>
    <section id={historyId} tabIndex={-1} className="panel match-history" aria-label="Histórico de partidas">
      <div className="section-title-row"><h2>Histórico de partidas</h2><button className="quiet-action" type="button" onClick={() => { setOpen(!open); if (open) setSelectedId(null) }}>{open ? 'Fechar histórico' : 'Abrir histórico'}</button></div>
      {open ? <MatchHistory key={authorizationVersion} client={client} group={group} selectedId={selectedId} onSelect={setSelectedId} /> : null}
    </section>
  </>
}
