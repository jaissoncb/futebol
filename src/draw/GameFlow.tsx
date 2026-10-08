import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react'
import type { GroupWithRole, Player } from '../groups/group-service'
import { drawTeams, DrawInputError, type DrawPlayer, type DrawResult } from './engine'
import { movePlayer, swapCourtStatus, swapPlayers, type AdjustmentState } from './adjustments'
import { localDateInputValue } from './local-date'
import type { FutebolSupabaseClient } from '../lib/supabase/client'
import { buildDrawPayload, TEAM_NAMES, type GameConfig, type SaveDrawPayload } from '../matches/draw-payload'
import { saveMatchDraw } from '../matches/match-service'

type GameStep = 'details' | 'participants' | 'result'

type SelectedPlayer = { teamIndex: number; id: string } | null

function editableResult(result: DrawResult, playersOnCourt: number): AdjustmentState {
  return { playersOnCourt, teams: result.teams.map((team) => ({ playerIds: [...team.playerIds], reserveIds: [...team.reserveIds] })) }
}

export function GameFlow({ group, players, client = null, onSaved, onAttemptChange }: { group: GroupWithRole; players: Player[]; client?: FutebolSupabaseClient | null; onSaved?: (id: string) => void; onAttemptChange?: (pending: boolean) => void }) {
  const [step, setStep] = useState<GameStep>('details')
  const [config, setConfig] = useState<GameConfig>({ name: '', matchDate: localDateInputValue(), matchTime: '', playersOnCourt: group.default_players_on_court, teamCount: 2 })
  const [selected, setSelected] = useState<string[]>([])
  const [result, setResult] = useState<DrawResult | null>(null)
  const [adjustment, setAdjustment] = useState<AdjustmentState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [runs, setRuns] = useState<DrawResult[]>([])
  const [drawContext, setDrawContext] = useState('')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'error' | 'saved'>('idle')
  const attempt = useRef<{ id: string; payload: SaveDrawPayload } | null>(null)
  const [frozenAttempt, setFrozenAttempt] = useState<{ id: string; payload: SaveDrawPayload } | null>(null)
  const submitting = useRef(false)
  const drawing = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [step, error, saveState])
  useEffect(() => {
    if (saveState !== 'saving' && saveState !== 'error') return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [saveState])
  if (group.role !== 'owner' && group.role !== 'admin') return null
  const eligible = players.filter((player) => player.active && player.group_id === group.id)
  const selectedEligible = selected.filter((id) => eligible.some((p) => p.id === id))
  const context = JSON.stringify([config, eligible.filter((p) => selected.includes(p.id)).map(toDrawPlayer).sort((a, b) => a.id.localeCompare(b.id))])
  const stale = result !== null && drawContext !== context
  const locked = saveState !== 'idle'
  const resultPlayers: Player[] = frozenAttempt ? frozenAttempt.payload.participants.map((p) => ({
    id: p.player_id, group_id: group.id, name: p.player_name_snapshot, nickname: p.player_nickname_snapshot,
    skill_rating: p.skill_rating_snapshot, is_goalkeeper: p.is_goalkeeper_snapshot, preferred_position: p.preferred_position_snapshot,
    active: true, created_at: '', updated_at: '',
  })) : eligible

  function invalidate() { setResult(null); setAdjustment(null); setRuns([]); setDrawContext('') }
  function beginGame(next: GameConfig) { if (JSON.stringify(next) !== JSON.stringify(config)) invalidate(); setConfig(next); setError(null); setStep('participants') }
  function input() { return { players: eligible.filter((p) => selected.includes(p.id)).map(toDrawPlayer), playersOnCourt: config.playersOnCourt, teamCount: config.teamCount } }
  async function draw(isReroll = false) {
    if (drawing.current || locked) return
    if (isReroll && adjustment && result && !sameTeams(adjustment, editableResult(result, config.playersOnCourt)) && !window.confirm('Um novo sorteio descartará os ajustes manuais. Continuar?')) return
    drawing.current = true; setBusy(true); setError(null)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    try {
      const next = drawTeams({ ...input(), seed: newSeed() })
      setResult(next); setAdjustment(editableResult(next, config.playersOnCourt))
      setRuns((previous) => drawContext === context ? [...previous, next] : [next]); setDrawContext(context)
      setStep('result')
    } catch (cause) { setError(cause instanceof DrawInputError ? cause.message : 'Não foi possível sortear os times. Tente novamente.') } finally { drawing.current = false; setBusy(false) }
  }
  async function save() {
    if (!client || !result || !adjustment || submitting.current || saveState === 'saved' || (stale && !attempt.current)) return
    submitting.current = true; setError(null); setSaveState('saving')
    try {
      // Freeze once, before the first network request. A retry uses these exact values.
      attempt.current ??= { id: crypto.randomUUID(), payload: buildDrawPayload(group.id, config, eligible, runs, adjustment) }
      setFrozenAttempt(attempt.current)
      onAttemptChange?.(true)
      const id = await saveMatchDraw(client, attempt.current.id, attempt.current.payload)
      setSaveState('saved'); onAttemptChange?.(false); onSaved?.(id)
    } catch {
      setSaveState(attempt.current ? 'error' : 'idle')
      setError(attempt.current ? 'Não foi possível confirmar o salvamento. A partida pode já ter sido salva. Tente novamente com os mesmos dados; não crie outra cópia.' : 'Não foi possível preparar o salvamento. Confira os dados e tente novamente.')
    } finally { submitting.current = false }
  }
  function abandon() {
    if (!window.confirm('A resposta pode ter sido perdida após o salvamento. Verifique o histórico antes de abandonar: salvar novamente após editar poderá criar outra partida. Abandonar esta tentativa?')) return
    attempt.current = null; setFrozenAttempt(null); setSaveState('idle'); setError(null)
    onAttemptChange?.(false)
    if (stale) { invalidate(); setStep('participants') }
  }
  return <section className="panel draw-panel" aria-label="Novo jogo">
    <div className="game-flow-heading"><div><p className="eyebrow">Novo jogo</p><h2 ref={heading} tabIndex={-1}>{step === 'details' ? 'Configure a partida' : step === 'participants' ? 'Quem vai jogar?' : 'Times sorteados'}</h2></div><p className="game-flow-step" aria-label={`Etapa ${step === 'details' ? 1 : step === 'participants' ? 2 : 3} de 3`}>{step === 'details' ? '1 de 3' : step === 'participants' ? '2 de 3' : '3 de 3'}</p></div>
    <p className="game-flow-note">{saveState === 'saved' ? 'Resultado salvo no histórico do grupo.' : saveState === 'saving' || saveState === 'error' ? 'Conclua esta tentativa ou abandone-a antes de sair desta tela. Confira o histórico se a resposta não chegar.' : 'O jogo existe apenas nesta tela até você salvar e aceitar o sorteio.'}</p>
    {step === 'details' ? <Details initial={config} onContinue={beginGame} /> : null}
    {step === 'participants' ? <Participants busy={busy} config={config} error={error} players={eligible} selected={selectedEligible} onBack={() => { setError(null); setStep('details') }} onDraw={() => void draw()} onSelectedChange={(ids) => { if (JSON.stringify([...ids].sort()) !== JSON.stringify([...selected].sort())) invalidate(); setSelected(ids); setError(null) }} /> : null}
    {step === 'result' && stale && !locked ? <div role="status"><p>O elenco ou a configuração mudou. Faça um novo sorteio; os sorteios anteriores serão descartados.</p><button className="quiet-action" onClick={() => { invalidate(); setSelected(selectedEligible); setStep('participants') }}>Revisar participantes</button></div> : null}
    {step === 'result' && result && adjustment && (!stale || locked) ? <>
      <fieldset className="result-editing" disabled={busy || locked}><legend className="sr-only">Ajustes da escalação</legend>
        <Results config={config} players={resultPlayers} original={result} state={adjustment} busy={busy} locked={locked} error={null} onChange={(next) => { if (!locked) setAdjustment(next) }} onReroll={() => void draw(true)} onEditGame={() => setStep('details')} onEditParticipants={() => setStep('participants')} />
      </fieldset>
      <p>{runs.length} sorteio(s) nesta partida. Somente o último será aceito.</p>
      {error ? <p className="form-status" role="alert">{error}</p> : null}
      {saveState === 'saved' ? <p className="adjustment-status" role="status">Partida salva e sorteio aceito. Consulte o resultado final no histórico.</p> : <button className="solid-action" type="button" disabled={!client || busy || saveState === 'saving'} onClick={() => void save()}>{saveState === 'saving' ? 'Salvando e aceitando…' : saveState === 'error' ? 'Tentar salvar novamente' : 'Salvar e aceitar sorteio'}</button>}
      {saveState === 'error' ? <button className="quiet-action" type="button" onClick={abandon}>Abandonar tentativa e editar</button> : null}
      {saveState === 'saved' && onSaved && frozenAttempt ? <button className="quiet-action" type="button" onClick={() => onSaved(frozenAttempt.id)}>Ver partida salva</button> : null}
    </> : null}
  </section>
}

function Details({ initial, onContinue }: { initial: GameConfig; onContinue: (value: GameConfig) => void }) {
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); onContinue({ name: stringValue(form, 'name'), matchDate: stringValue(form, 'matchDate'), matchTime: stringValue(form, 'matchTime'), playersOnCourt: Number(form.get('playersOnCourt')), teamCount: Number(form.get('teamCount')) }) }
  return <form className="data-form" onSubmit={submit}><label>Nome <span>(opcional)</span><input name="name" defaultValue={initial.name} minLength={2} maxLength={80} placeholder="Ex.: Futebol de quinta" /></label><div className="form-grid"><label>Data<input name="matchDate" type="date" defaultValue={initial.matchDate} required /></label><label>Horário <span>(opcional)</span><input name="matchTime" type="time" defaultValue={initial.matchTime} /></label></div><div className="form-grid"><label>Times<select aria-label="Times" name="teamCount" defaultValue={initial.teamCount}><option value={2}>2 times</option><option value={3}>3 times</option></select></label><label>Em quadra por time<input name="playersOnCourt" type="number" min="1" max="20" defaultValue={initial.playersOnCourt} required /></label></div><button className="solid-action" type="submit">Selecionar participantes</button></form>
}

function Participants({ busy, config, error, players, selected, onBack, onDraw, onSelectedChange }: { busy: boolean; config: GameConfig; error: string | null; players: Player[]; selected: string[]; onBack: () => void; onDraw: () => void; onSelectedChange: (ids: string[]) => void }) {
  if (players.length === 0) return <div className="empty-list"><p>Nenhum jogador ativo disponível.</p><span>Cadastre ou reative jogadores no elenco antes de criar o jogo.</span><button className="quiet-action" type="button" onClick={onBack}>Voltar à configuração</button></div>
  const toggle = (id: string, checked: boolean) => onSelectedChange(checked ? [...selected, id] : selected.filter((entry) => entry !== id))
  return <div className="game-participants"><p className="game-summary">{config.teamCount} times · {config.playersOnCourt} em quadra por time</p><div className="draw-actions"><button className="quiet-action" type="button" disabled={busy} onClick={() => onSelectedChange(players.map((p) => p.id))}>Selecionar todos</button><button className="quiet-action" type="button" disabled={busy} onClick={() => onSelectedChange([])}>Limpar seleção</button></div><fieldset className="draw-controls" disabled={busy}><legend>Jogadores ativos</legend>{players.map((p) => <label className="draw-player-option" key={p.id}><input type="checkbox" checked={selected.includes(p.id)} onChange={(event) => toggle(p.id, event.target.checked)} /><span>{p.nickname || p.name} · Nível {Number(p.skill_rating).toFixed(1)}{p.is_goalkeeper ? ' · Goleiro' : ''}</span></label>)}</fieldset><p aria-live="polite">{selected.length} jogadores selecionados</p><p>Todos os selecionados entram em um time. Times incompletos e reservas por time são permitidos.</p>{error ? <p className="form-status" role="alert">{error}</p> : null}<div className="game-flow-actions"><button className="quiet-action" type="button" disabled={busy} onClick={onBack}>Voltar</button><button className="solid-action" type="button" disabled={busy || selected.length < config.teamCount} onClick={onDraw}>{busy ? 'Sorteando…' : 'Sortear times'}</button></div></div>
}

function Results({ config, players, original, state, busy, locked, error, onChange, onReroll, onEditGame, onEditParticipants }: { config: GameConfig; players: Player[]; original: DrawResult; state: AdjustmentState; busy: boolean; locked: boolean; error: string | null; onChange: (state: AdjustmentState) => void; onReroll: () => void; onEditGame: () => void; onEditParticipants: () => void }) {
  const [selected, setSelected] = useState<SelectedPlayer>(null)
  const [dragging, setDragging] = useState<SelectedPlayer>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const drawPlayers = new Map(players.map((player) => [player.id, toDrawPlayer(player)]))
  const adjusted = !sameTeams(state, editableResult(original, config.playersOnCourt))
  const currentScore = balanceScore(state, drawPlayers)
  const resultHeading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { resultHeading.current?.focus() }, [original.seed])
  function apply(action: ReturnType<typeof movePlayer>) { if (busy || locked) return; if (action.ok) { onChange(action.state); setSelected(null); setDragging(null); setNotice('Ajuste aplicado. As métricas foram atualizadas.'); resultHeading.current?.focus(); return } setNotice(action.message) }
  function dropOnTeam(event: DragEvent<HTMLElement>, teamIndex: number) { event.preventDefault(); if (dragging) apply(movePlayer(state, dragging.teamIndex, dragging.id, teamIndex, drawPlayers)); setDragging(null) }
  function dropOnPlayer(event: DragEvent<HTMLElement>, teamIndex: number, playerId: string) { event.preventDefault(); event.stopPropagation(); if (dragging && (dragging.teamIndex !== teamIndex || dragging.id !== playerId)) apply(swapPlayers(state, dragging.teamIndex, dragging.id, teamIndex, playerId, drawPlayers)); setDragging(null) }
  return <section aria-label="Resultado do sorteio" aria-live="polite" className="draw-result"><div className="result-title"><div><h3 ref={resultHeading} tabIndex={-1}>{config.name.trim() || 'Jogo sem nome'}</h3><p>{formatDate(config.matchDate)}{config.matchTime ? ` · ${config.matchTime}` : ''} · {config.teamCount} times</p></div><button className="quiet-action" type="button" disabled={busy} onClick={() => { setSelected(null); setDragging(null); onReroll() }}>{busy ? 'Sorteando…' : 'Novo sorteio'}</button></div><p>{adjusted ? `Ajustado manualmente · diferença atual entre médias: ${currentScore.toFixed(2)}. Não houve reotimização automática.` : `Diferença entre médias: ${original.balanceScore.toFixed(2)}. Quanto menor, mais próximos os níveis médios.`}</p><p className="game-flow-note">Arraste um jogador sobre outro para trocar os times. No celular ou com teclado, selecione um jogador e use os botões de troca ou de titulares/reservas.</p>{notice ? <p className="adjustment-status" role="status">{notice}</p> : null}{error ? <p className="form-status" role="alert">{error}</p> : null}<div className="draw-teams">{state.teams.map((team, index) => <Team key={TEAM_NAMES[index]} team={team} index={index} players={players} selected={selected} onSelect={setSelected} onDrag={setDragging} onDropTeam={dropOnTeam} onDropPlayer={dropOnPlayer} onApply={apply} state={state} drawPlayers={drawPlayers} />)}</div><p className="game-flow-note">Confira a escalação final antes de salvar e aceitar.</p><div className="game-flow-actions"><button className="quiet-action" type="button" onClick={onEditGame}>Editar jogo</button><button className="solid-action" type="button" onClick={onEditParticipants}>Voltar aos participantes</button></div></section>
}

function Team({ team, index, players, selected, onSelect, onDrag, onDropTeam, onDropPlayer, onApply, state, drawPlayers }: { team: AdjustmentState['teams'][number]; index: number; players: Player[]; selected: SelectedPlayer; onSelect: (value: SelectedPlayer) => void; onDrag: (value: SelectedPlayer) => void; onDropTeam: (event: DragEvent<HTMLElement>, index: number) => void; onDropPlayer: (event: DragEvent<HTMLElement>, index: number, id: string) => void; onApply: (result: ReturnType<typeof movePlayer>) => void; state: AdjustmentState; drawPlayers: Map<string, DrawPlayer> }) {
  const court = team.playerIds.filter((id) => !team.reserveIds.includes(id)); const reserves = team.reserveIds
  const goalkeeperCount = team.playerIds.filter((id) => drawPlayers.get(id)?.isGoalkeeper).length
  const sum = team.playerIds.reduce((total, id) => total + (drawPlayers.get(id)?.skillRating ?? 0), 0); const missing = Math.max(0, state.playersOnCourt - team.playerIds.length)
  return <article className="draw-team" onDragOver={(event) => event.preventDefault()} onDrop={(event) => onDropTeam(event, index)}><h3>Time {TEAM_NAMES[index]}</h3>{selected && selected.teamIndex !== index ? <button className="quiet-action" type="button" onClick={() => onApply(movePlayer(state, selected.teamIndex, selected.id, index, drawPlayers))}>Mover selecionado para este time</button> : null}<p>{team.playerIds.length} jogadores · Média {team.playerIds.length ? (sum / team.playerIds.length).toFixed(2) : '0.00'} · Soma {sum.toFixed(1)}</p><p>{goalkeeperCount} goleiro(s)</p>{goalkeeperCount === 0 ? <p className="team-warning">Sem goleiro disponível neste time.</p> : null}{missing > 0 ? <p className="team-warning">{team.playerIds.length}/{state.playersOnCourt} em quadra — precisa de {missing} jogador(es) emprestado(s)</p> : null}<Roster title="Em quadra" ids={court} teamIndex={index} players={players} selected={selected} onSelect={onSelect} onDrag={onDrag} onDropPlayer={onDropPlayer} onApply={onApply} state={state} drawPlayers={drawPlayers} /><Roster title="Reservas" ids={reserves} teamIndex={index} players={players} selected={selected} onSelect={onSelect} onDrag={onDrag} onDropPlayer={onDropPlayer} onApply={onApply} state={state} drawPlayers={drawPlayers} /></article>
}

function Roster({ title, ids, teamIndex, players, selected, onSelect, onDrag, onDropPlayer, onApply, state, drawPlayers }: { title: string; ids: string[]; teamIndex: number; players: Player[]; selected: SelectedPlayer; onSelect: (value: SelectedPlayer) => void; onDrag: (value: SelectedPlayer) => void; onDropPlayer: (event: DragEvent<HTMLElement>, index: number, id: string) => void; onApply: (result: ReturnType<typeof movePlayer>) => void; state: AdjustmentState; drawPlayers: Map<string, DrawPlayer> }) {
  return <section className="team-roster" aria-label={`${title} do Time ${TEAM_NAMES[teamIndex]}`}><h4>{title}</h4><ul>{ids.map((id) => { const player = players.find((entry) => entry.id === id)!; const isSelected = selected?.teamIndex === teamIndex && selected.id === id; const counterpart = selected && selected.teamIndex === teamIndex && selected.id !== id ? selected.id : null; return <li key={id} className={isSelected ? 'selected-player' : ''} draggable onDragStart={(event) => { event.dataTransfer.setData('text/plain', id); event.dataTransfer.effectAllowed = 'move'; onDrag({ teamIndex, id }) }} onDragEnd={() => onDrag(null)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => onDropPlayer(event, teamIndex, id)}><span>{playerName(player)} · Nível {Number(player.skill_rating).toFixed(1)}{player.is_goalkeeper ? ' · Goleiro' : ''}</span><div className="player-adjustments"><button className="quiet-action" type="button" aria-pressed={isSelected} onClick={() => onSelect(isSelected ? null : { teamIndex, id })}>{isSelected ? 'Cancelar ajuste' : 'Selecionar para ajuste'}</button>{selected && selected.teamIndex !== teamIndex ? <button className="quiet-action" type="button" onClick={() => onApply(swapPlayers(state, selected.teamIndex, selected.id, teamIndex, id, drawPlayers))}>Trocar com selecionado</button> : null}{counterpart ? <button className="quiet-action" type="button" onClick={() => onApply(swapCourtStatus(state, teamIndex, counterpart, id, drawPlayers))}>Trocar titular/reserva</button> : null}</div></li> })}</ul></section>
}

function stringValue(form: FormData, name: string): string { const value = form.get(name); return typeof value === 'string' ? value : '' }
function formatDate(value: string): string { if (!value) return 'Data não informada'; const [year, month, day] = value.split('-'); return `${day}/${month}/${year}` }
function toDrawPlayer(player: Player): DrawPlayer { return { id: player.id, skillRating: Number(player.skill_rating), isGoalkeeper: player.is_goalkeeper } }
function playerName(player: Player) { return player.nickname || player.name }
function newSeed() { return Array.from(crypto.getRandomValues(new Uint32Array(4)), (word) => word.toString(16).padStart(8, '0')).join('') }
function sameTeams(first: AdjustmentState, second: AdjustmentState) { return JSON.stringify(first.teams) === JSON.stringify(second.teams) }
function balanceScore(state: AdjustmentState, players: ReadonlyMap<string, DrawPlayer>) { const means = state.teams.map((team) => team.playerIds.reduce((sum, id) => sum + (players.get(id)?.skillRating ?? 0), 0) / team.playerIds.length); return Math.max(...means) - Math.min(...means) }
