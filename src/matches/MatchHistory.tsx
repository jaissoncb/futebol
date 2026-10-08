import { useEffect, useRef, useState } from 'react'
import type { FutebolSupabaseClient } from '../lib/supabase/client'
import type { GroupWithRole } from '../groups/group-service'
import type { Tables } from '../lib/supabase/database.types'
import { HISTORY_PAGE_SIZE, loadMatchHistory, loadSavedMatch, type SavedMatch } from './match-service'
import { formatMatchDate, shareSavedResult } from './share-result'

export function MatchHistory({ client, group, selectedId, onSelect }: { client: FutebolSupabaseClient | null; group: GroupWithRole; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const [revision, setRevision] = useState(0)
  return selectedId ? <MatchDetail key={selectedId} client={client} groupId={group.id} id={selectedId} onBack={() => { onSelect(null); setRevision((n) => n + 1) }} />
    : <HistoryList key={`${group.id}:${revision}`} client={client} groupId={group.id} onSelect={onSelect} />
}

function HistoryList({ client, groupId, onSelect }: { client: FutebolSupabaseClient | null; groupId: string; onSelect: (id: string) => void }) {
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => { list.current?.focus() }, [])
  const [rows, setRows] = useState<Tables<'matches'>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [page, setPage] = useState(0)
  const [more, setMore] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(async () => {
      if (cancelled) return
      setLoading(true); setError(false)
      try {
        if (!client) throw new Error('Conexão indisponível.')
        const loaded = await loadMatchHistory(client, groupId, page)
        if (!cancelled) { setRows((current) => page === 0 ? loaded : [...current, ...loaded.filter((row) => !current.some((m) => m.id === row.id))]); setMore(loaded.length === HISTORY_PAGE_SIZE) }
      } catch { if (!cancelled) setError(true) }
      finally { if (!cancelled) setLoading(false) }
    })
    return () => { cancelled = true }
  }, [client, groupId, page, revision])
  return <div ref={list} tabIndex={-1} aria-label="Lista de partidas" aria-busy={loading}>
    {loading ? <p role="status">Carregando histórico…</p> : null}
    {error ? <div role="alert"><p>Não foi possível carregar o histórico.</p><button className="quiet-action" onClick={() => setRevision((n) => n + 1)}>Tentar novamente</button></div> : null}
    {!loading && !error && !rows.length ? <p>Nenhuma partida salva neste grupo.</p> : null}
    <ul className="match-history-list">{rows.map((match) => <li key={match.id}><button className="quiet-action history-entry" onClick={() => onSelect(match.id)}><strong>{match.name || 'Partida sem nome'}</strong>{' '}<span>{formatMatchDate(match.match_date)}{match.match_time ? ` · ${match.match_time.slice(0, 5)}` : ''} · {match.team_count} times</span></button></li>)}</ul>
    {more && !error ? <button className="quiet-action" disabled={loading} onClick={() => setPage((n) => n + 1)}>Carregar mais partidas</button> : null}
  </div>
}

function MatchDetail({ client, groupId, id, onBack }: { client: FutebolSupabaseClient | null; groupId: string; id: string; onBack: () => void }) {
  const detail = useRef<HTMLElement>(null)
  const [saved, setSaved] = useState<SavedMatch | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [revision, setRevision] = useState(0)
  const [sharing, setSharing] = useState(false)
  const [shareNotice, setShareNotice] = useState<string | null>(null)
  const shareLock = useRef(false)
  useEffect(() => { detail.current?.focus() }, [loading, error])
  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(async () => {
      if (cancelled) return
      setLoading(true); setError(false)
      try {
        if (!client) throw new Error('Conexão indisponível.')
        const result = await loadSavedMatch(client, groupId, id)
        if (!cancelled) setSaved(result)
      } catch { if (!cancelled) setError(true) }
      finally { if (!cancelled) setLoading(false) }
    })
    return () => { cancelled = true }
  }, [client, groupId, id, revision])
  async function share() {
    if (!saved || shareLock.current) return
    shareLock.current = true; setSharing(true); setShareNotice(null)
    try {
      const outcome = await shareSavedResult(saved)
      setShareNotice(outcome === 'shared' ? 'Resultado compartilhado.' : outcome === 'copied' ? 'Resultado copiado para a área de transferência.' : 'Compartilhamento cancelado.')
    } catch { setShareNotice('Não foi possível compartilhar ou copiar. Tente novamente.') }
    finally { shareLock.current = false; setSharing(false) }
  }
  return <section ref={detail} tabIndex={-1} aria-label="Partida salva" aria-busy={loading}>
    <button className="quiet-action" onClick={onBack}>Voltar ao histórico</button>
    {loading ? <p role="status">Carregando partida…</p> : error ? <div role="alert"><p>Não foi possível carregar a partida salva. Ela pode estar indisponível ou incompleta.</p><button className="quiet-action" onClick={() => setRevision((n) => n + 1)}>Tentar novamente</button></div> : saved ? <>
      <h3>{saved.match.name || 'Partida sem nome'}</h3>
      <p>{formatMatchDate(saved.match.match_date)}{saved.match.match_time ? ` · ${saved.match.match_time.slice(0, 5)}` : ''} · {saved.match.team_count} times · {saved.match.players_on_court} em quadra por time</p>
      <p className="adjustment-status">Salva · Sorteio aceito</p>
      <div className="draw-teams">{saved.teams.map((team) => <article className="draw-team" key={team.id}><h3>Time {team.name}</h3>{([false, true] as const).map((reserve) => <section key={String(reserve)} aria-label={`${reserve ? 'Reservas' : 'Titulares'} do Time ${team.name}`}><h4>{reserve ? 'Reservas' : 'Titulares'}</h4><ul>{saved.assignments.filter((a) => a.team_id === team.id && a.starts_as_reserve === reserve).map((a) => {
        const p = saved.participants.find((p) => p.player_id === a.player_id)!
        return <li key={p.player_id}>{p.player_nickname_snapshot || p.player_name_snapshot}{p.player_nickname_snapshot ? ` (${p.player_name_snapshot})` : ''} · Nível {Number(p.skill_rating_snapshot).toFixed(1)}{p.is_goalkeeper_snapshot ? ' · Goleiro' : ''}{p.preferred_position_snapshot ? ` · ${POSITION_LABELS[p.preferred_position_snapshot]}` : ''}{a.assignment_source === 'manual' ? ' · Ajuste manual' : ''}</li>
      })}</ul>{!saved.assignments.some((a) => a.team_id === team.id && a.starts_as_reserve === reserve) ? <p>Nenhum</p> : null}</section>)}</article>)}</div>
      <details className="saved-draw-data"><summary>Informações dos sorteios ({saved.runs.length})</summary><ol>{saved.runs.map((run) => <li key={run.id}>Sorteio {run.run_number}{run.accepted ? ' · Aceito (sorteio-base)' : ' · Não aceito'}<br />Código do sorteio: <code>{run.seed}</code><br />Versão: <code>{run.algorithm_version}</code> · Diferença entre médias: {Number(run.balance_score).toFixed(3)}</li>)}</ol></details>
      <p className="game-flow-note">A escalação acima é o resultado final salvo, incluindo ajustes manuais. O código identifica o sorteio-base.</p>
      <button className="solid-action" disabled={sharing} onClick={() => void share()}>{sharing ? 'Compartilhando…' : 'Compartilhar resultado'}</button>
      {shareNotice ? <p role="status">{shareNotice}</p> : null}
    </> : null}
  </section>
}

const POSITION_LABELS = { goalkeeper: 'Goleiro', defense: 'Defesa', midfield: 'Meio-campo', attack: 'Ataque', any: 'Qualquer posição' }
