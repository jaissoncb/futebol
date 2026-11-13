import { type DetailsInput, type DrawAttempt, type GameStep, type MatchDraft } from '../drafts/models'
import { useDraftAutosave, type DraftWriter } from '../drafts/use-draft'
import { reconcileAttempt } from '../drafts/reconcile'
import { brokenRule, describeRule, ruleAvailable, type DrawRule } from './draw-rules'
import { historicalWeights, repeatedPairs, type HistoricalSnapshot } from './historical-engine'
import { loadDrawHistory } from '../matches/draw-history'
import { RulesEditor } from './RulesEditor'
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react'
import type { GroupWithRole, Player } from '../groups/group-service'
import { DrawInputError, type DrawPlayer, type DrawResult } from './engine'
import { DRAW_MODES, drawByMode, meanGap, modeForVersion, usesHistory, type DrawMode } from './smart-engine'
import { movePlayer, swapCourtStatus, swapPlayers, type AdjustmentState } from './adjustments'
import { localDateInputValue } from './local-date'
import type { FutebolDataClient } from '../lib/data-client'
import { buildDrawPayload, TEAM_NAMES, type GameConfig } from '../matches/draw-payload'
import { saveMatchDraw } from '../matches/match-service'
import type { RepeatDraft } from '../matches/repeat-match'
import { searchPlayers } from '../groups/player-search'
import { TeamCard } from './TeamCard'
import { ConfirmationDialog } from '../ConfirmationDialog'
import { useConfirmation } from '../useConfirmation'

type SelectedPlayer = { teamIndex: number; id: string } | null

function editableResult(result: DrawResult, playersOnCourt: number): AdjustmentState {
  return { playersOnCourt, teams: result.teams.map((team) => ({ playerIds: [...team.playerIds], reserveIds: [...team.reserveIds] })) }
}

export function GameFlow({ group, players, client = null, onSaved, onAttemptChange, onDraftChange, initialDraft, authorizationVersion, restored, writer, requireDurable, draftUserId, onDiscard }: { group: GroupWithRole; players: Player[]; client?: FutebolDataClient | null; onSaved?: (id: string) => void; onAttemptChange?: (pending: boolean) => void; onDraftChange?: (dirty: boolean) => void; initialDraft?: RepeatDraft; authorizationVersion?: number; restored?: MatchDraft | null; writer?: DraftWriter<MatchDraft>; requireDurable?: boolean; draftUserId?: string; onDiscard?: () => void }) {
  const { confirm, dialogProps } = useConfirmation()
  const [step, setStep] = useState<GameStep>(restored?.step ?? (initialDraft ? 'participants' : 'details'))
  const [config, setConfig] = useState<GameConfig>(restored?.config ?? (initialDraft ? { ...initialDraft.config, drawMode: initialDraft.config.drawMode ?? 'classic' } : { drawMode: 'classic', name: '', matchDate: localDateInputValue(), matchTime: '', playersOnCourt: group.default_players_on_court, teamCount: 2 }))
  const [details, setDetails] = useState<DetailsInput>(restored?.details ?? detailsInput(config))
  const [selected, setSelected] = useState<string[]>(restored?.selected ?? initialDraft?.selectedIds ?? [])
  const [rules, setRules] = useState<DrawRule[]>(restored?.rules ?? [])
  const [rulesNotice, setRulesNotice] = useState<string | null>(null)

  const [adjustment, setAdjustment] = useState<AdjustmentState | null>(restored?.adjustment ?? null)
  const [error, setError] = useState<string | null>(null)
  const [historyFailed, setHistoryFailed] = useState(false)
  const [historySummary, setHistorySummary] = useState<string | null>(restored?.historySummary ?? null)
  const history = useRef<{ key: string; snapshot: HistoricalSnapshot } | null>(null)
  const historyScope = useRef<AbortController | null>(null)
  useEffect(() => {
    const scope = new AbortController()
    historyScope.current = scope
    const clear = () => { scope.abort(); history.current = null }
    const unsubscribe = client?.subscribeClosed?.(clear)
    return () => { clear(); unsubscribe?.() }
  }, [client, group.id, authorizationVersion])
  const [busy, setBusy] = useState(false)
  const [runs, setRuns] = useState<DrawResult[]>(restored?.runs ?? [])
  const result = runs.at(-1) ?? null
  const [drawContext, setDrawContext] = useState(restored?.drawContext ?? '')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'error' | 'saved'>(restored?.attempt ? 'error' : 'idle')
  const [draftChanged, setDraftChanged] = useState(Boolean(initialDraft || restored))
  const dirty = draftChanged && saveState !== 'saved'
  useEffect(() => { onDraftChange?.(dirty) }, [dirty, onDraftChange])
  const attempt = useRef<DrawAttempt | null>(restored?.attempt ?? null)
  const [frozenAttempt, setFrozenAttempt] = useState<DrawAttempt | null>(restored?.attempt ?? null)
  const [reconciliation, setReconciliation] = useState<'checking' | 'missing' | 'unknown' | 'mismatch' | null>(restored?.attempt ? 'checking' : null)
  const [lookup, setLookup] = useState(0)
  const snapshot: MatchDraft = { step, config, details, selected, rules, runs, adjustment, drawContext, historySummary, attempt: frozenAttempt }
  useDraftAutosave(writer, dirty && !frozenAttempt ? snapshot : null, step === 'details' ? 180 : 0, restored)
  const submitting = useRef(false)
  const drawing = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [step, error, saveState])
  useEffect(() => {
    if (writer && saveState !== 'saving') return
    if (!dirty && saveState !== 'saving' && saveState !== 'error') return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, saveState, writer])
  useEffect(() => {
    if (!client || !draftUserId || !writer || !frozenAttempt || saveState !== 'error') return
    let active = true
    void reconcileAttempt(client, frozenAttempt, draftUserId).then(async outcome => {
      if (!active) return
      setReconciliation(outcome === 'saved' ? 'checking' : outcome)
      if (outcome !== 'saved') return
      await writer.commit(null)
      if (!active) return
      setSaveState('saved'); onAttemptChange?.(false); onSaved?.(frozenAttempt.id)
    })
    return () => { active = false }
  }, [client, draftUserId, writer, frozenAttempt, saveState, authorizationVersion, lookup, onAttemptChange, onSaved])
  useEffect(() => {
    if (restored?.attempt) onAttemptChange?.(true)
  }, [restored, onAttemptChange])
  if (group.role !== 'owner' && group.role !== 'admin') return null
  const eligible = players.filter((player) => player.active && player.group_id === group.id)
  const selectedEligible = selected.filter((id) => eligible.some((p) => p.id === id))
  const context = JSON.stringify([config, rules, eligible.filter((p) => selected.includes(p.id)).map(toDrawPlayer).sort((a, b) => a.id.localeCompare(b.id))])
  const stale = result !== null && drawContext !== context
  const locked = saveState !== 'idle'
  const resultPlayers: Player[] = frozenAttempt ? frozenAttempt.payload.participants.map((p) => ({
    id: p.player_id, group_id: group.id, name: p.player_name_snapshot, nickname: p.player_nickname_snapshot,
    skill_rating: p.skill_rating_snapshot, is_goalkeeper: p.is_goalkeeper_snapshot, preferred_position: p.preferred_position_snapshot,
    active: true, created_at: '', updated_at: '',
  })) : eligible

  function invalidate() { setAdjustment(null); setRuns([]); setDrawContext(''); setHistorySummary(null); setHistoryFailed(false) }
  async function confirmDiscard() {
    return !adjustment || !result || sameTeams(adjustment, editableResult(result, config.playersOnCourt)) ||
      await confirm({ title: 'Descartar ajustes da escalação?', message: 'Esta alteração exige um novo sorteio e descarta os ajustes manuais.', action: 'Descartar ajustes e continuar' })
  }
  function pruneRules(ids: string[], teamCount: number) {
    const available = new Set(ids)
    const next = rules.filter(rule => ruleAvailable(rule, available, teamCount))
    setRules(next)
    setRulesNotice(next.length === rules.length ? null : 'Foram removidas regras de jogadores desmarcados ou times desativados.')
  }
  async function beginGame(next: GameConfig) {
    if (JSON.stringify(next) !== JSON.stringify(config)) {
      if (!await confirmDiscard()) return
      invalidate()
      pruneRules(selectedEligible, next.teamCount)
    }
    setDraftChanged(true); setConfig(next); setDetails(detailsInput(next)); setError(null); setStep('participants')
  }
  async function changeRules(next: DrawRule[]) {
    if (drawing.current || locked || !await confirmDiscard()) return false
    invalidate()
    setRules(next); setRulesNotice(null); setError(null); setDraftChanged(true)
    return true
  }
  async function changeParticipants(ids: string[]) {
    if (JSON.stringify([...ids].sort()) === JSON.stringify([...selected].sort())) return
    if (!await confirmDiscard()) return
    invalidate()
    pruneRules(ids, config.teamCount)
    setSelected(ids); setError(null); setDraftChanged(true)
  }
  function input() { return { players: eligible.filter((p) => selected.includes(p.id)).map(toDrawPlayer), playersOnCourt: config.playersOnCourt, teamCount: config.teamCount } }
  async function draw(isReroll = false) {
    if (drawing.current || locked) return
    if (isReroll && adjustment && result && !sameTeams(adjustment, editableResult(result, config.playersOnCourt)) && !await confirm({ title: 'Sortear novamente?', message: 'Um novo sorteio descartará os ajustes manuais desta escalação.', action: 'Descartar ajustes e sortear' })) return
    if (!isReroll && !await confirmDiscard()) return
    if (drawing.current) return
    drawing.current = true; setBusy(true); setError(null); setHistoryFailed(false)
    const signal = historyScope.current?.signal
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    try {
      if (signal?.aborted) return
      let snapshot: HistoricalSnapshot | undefined
      if (config.avoidRecentRepeats && config.drawMode !== 'classic') {
        const key = JSON.stringify([config.matchDate, config.matchTime])
        try {
          if (!client || !signal || client.isClosed()) throw new Error()
          if (history.current?.key !== key) {
            const loaded = await loadDrawHistory(client, group.id, config.matchDate, config.matchTime, signal)
            signal.throwIfAborted()
            history.current = { key, snapshot: loaded }
          }
          snapshot = history.current.snapshot
        } catch {
          if (!signal?.aborted) setHistoryFailed(true)
          return
        }
      }
      const drawInput = { ...input(), seed: newSeed() }
      const next = drawByMode(drawInput, config.drawMode, rules, id => eligible.find(player => player.id === id)?.name ?? id, snapshot)
      if (!snapshot) setHistorySummary(null)
      else if (!usesHistory(next.algorithmVersion)) {
        setHistorySummary(`Histórico ativado · ${snapshot.length} partida(s) considerada(s). Histórico insuficiente para comparar pares deste elenco.`)
      } else {
        const pairs = repeatedPairs(next.teams, historicalWeights(snapshot, new Set(drawInput.players.map(player => player.id))))
        setHistorySummary(`Histórico ativado · ${snapshot.length} partida(s) considerada(s). No sorteio-base, ${pairs.roster} par(es) já jogaram juntos, com ${pairs.starters} repetição(ões) entre titulares.`)
      }
      setAdjustment(editableResult(next, config.playersOnCourt))
      setRuns((previous) => drawContext === context ? [...previous, next] : [next]); setDrawContext(context)
      setStep('result')
    } catch (cause) { setError(cause instanceof DrawInputError ? cause.message : 'Não foi possível sortear os times. Tente novamente.') } finally { drawing.current = false; setBusy(false) }
  }
  async function save() {
    if (!client || !result || !adjustment || submitting.current || saveState === 'saved'
      || (stale && !attempt.current) || reconciliation === 'checking' || reconciliation === 'mismatch'
      || (requireDurable && !writer)) return
    submitting.current = true; setError(null); setSaveState('saving'); onAttemptChange?.(true)
    try {
      const pending = attempt.current ?? { id: crypto.randomUUID(), payload: buildDrawPayload(group.id, config, eligible, runs, adjustment) }
      // CAS also verifies that no other tab has discarded or completed this attempt.
      if (writer && !await writer.commit({ ...snapshot, attempt: pending })) {
        if (!attempt.current) onAttemptChange?.(false)
        setSaveState(attempt.current ? 'error' : 'idle')
        setError('Não foi possível guardar a tentativa no dispositivo. Nenhum envio foi iniciado por esta ação.')
        return
      }
      attempt.current = pending
      setFrozenAttempt(pending)
      const id = await saveMatchDraw(client, pending.id, pending.payload)
      await writer?.commit(null)
      setSaveState('saved'); onAttemptChange?.(false); onSaved?.(id)
    } catch {
      if (!attempt.current) onAttemptChange?.(false)
      setReconciliation(attempt.current && writer ? 'checking' : null)
      setSaveState(attempt.current ? 'error' : 'idle')
      setError(attempt.current ? 'Não foi possível confirmar o salvamento. A partida pode já ter sido salva. Tente novamente com os mesmos dados; não crie outra cópia.' : 'Não foi possível preparar o salvamento. Confira os dados e tente novamente.')
    } finally { submitting.current = false }
  }
  async function abandon() {
    if (!await confirm({ title: 'Abandonar esta tentativa?', message: 'A partida pode já ter sido salva. Verifique o histórico antes de abandonar: salvar novamente após editar poderá criar outra partida.', action: 'Abandonar e editar', cancel: 'Manter tentativa' })) return
    const editable: MatchDraft = stale ? { ...snapshot, step: 'participants', runs: [], adjustment: null, drawContext: '', historySummary: null, attempt: null } : { ...snapshot, attempt: null }
    if (writer && !await writer.commit(editable)) return
    attempt.current = null; setFrozenAttempt(null); setSaveState('idle'); setReconciliation(null); setError(null)
    onAttemptChange?.(false)
    if (stale) { invalidate(); setStep('participants') }
  }
  async function discard() {
    if (!writer || !await confirm({ title: 'Descartar rascunho?', message: 'A edição desta partida será removida deste dispositivo.', action: 'Descartar rascunho' })) return
    if (await writer.commit(null)) { onDraftChange?.(false); onDiscard?.() }
  }
  return <section className="panel draw-panel" aria-label="Novo jogo">
    <ConfirmationDialog {...dialogProps} />
    <div className="game-flow-heading"><div><p className="eyebrow">Novo jogo</p><h2 ref={heading} tabIndex={-1}>{step === 'details' ? 'Configure a partida' : step === 'participants' ? 'Quem vai jogar?' : 'Times sorteados'}</h2></div><p className="game-flow-step" aria-label={`Etapa ${step === 'details' ? 1 : step === 'participants' ? 2 : 3} de 3`}>{step === 'details' ? '1 de 3' : step === 'participants' ? '2 de 3' : '3 de 3'}</p></div>
    <p className="game-flow-note">{saveState === 'saved' ? 'Resultado salvo no histórico do grupo.' : saveState === 'saving' || saveState === 'error' ? 'Conclua esta tentativa ou abandone-a antes de sair desta tela. Confira o histórico se a resposta não chegar.' : 'A partida entra no histórico quando você salvar e aceitar o sorteio.'}</p>
    {step === 'details' ? <Details initial={details} onEdit={next => { setDetails(next); setDraftChanged(true) }} onContinue={next => void beginGame(next)} /> : null}
    {dirty && saveState === 'idle' && onDiscard && <button className="quiet-action" type="button" disabled={busy} onClick={() => void discard()}>Descartar rascunho</button>}
    {step === 'participants' ? <Participants busy={busy} config={config} error={error} players={eligible} selected={selectedEligible} rules={rules} rulesNotice={rulesNotice} onRulesChange={changeRules} onBack={() => { setError(null); setStep('details') }} onDraw={() => void draw()} onSelectedChange={ids => void changeParticipants(ids)} /> : null}
    {historyFailed && <div><p className="form-status" role="alert">Não foi possível carregar o histórico. Tente sortear novamente ou desative o histórico para continuar.</p><button type="button" className="quiet-action" disabled={busy || locked} onClick={() => { setConfig({ ...config, avoidRecentRepeats: false }); setDetails({ ...details, avoidRecentRepeats: false }); invalidate(); setStep('participants') }}>Desativar histórico</button></div>}
    {step === 'result' && stale && !locked ? <div role="status"><p>O elenco ou a configuração mudou. Faça um novo sorteio; os sorteios anteriores serão descartados.</p><button className="quiet-action" onClick={() => { invalidate(); setSelected(selectedEligible); setStep('participants') }}>Revisar participantes</button></div> : null}
    {step === 'result' && result && adjustment && (!stale || locked) ? <>
      <fieldset className="result-editing" disabled={busy || locked}><legend className="sr-only">Ajustes da escalação</legend>
        <Results config={config} players={resultPlayers} original={result} state={adjustment} rules={rules} busy={busy} locked={locked} error={null} onChange={(next) => { if (!locked) setAdjustment(next) }} onReroll={() => void draw(true)} onEditGame={() => setStep('details')} onEditParticipants={() => setStep('participants')} />
      </fieldset>
      {historySummary && <p role="status">{historySummary}</p>}
      <p>{runs.length} sorteio(s) nesta partida. Somente o último será aceito.</p>
      {error ? <p className="form-status" role="alert">{error}</p> : null}
      <div className="save-draw-actions">{saveState === 'saved' ? <p className="adjustment-status" role="status">Partida salva e sorteio aceito. Consulte o resultado final no histórico.</p> : <button className="solid-action" type="button" disabled={!client || busy || saveState === 'saving' || reconciliation === 'checking' || reconciliation === 'mismatch' || (requireDurable && !writer)} onClick={() => void save()}>{saveState === 'saving' ? 'Salvando e aceitando…' : saveState === 'error' ? 'Tentar salvar novamente' : 'Salvar e aceitar sorteio'}</button>}</div>
      {reconciliation && saveState === 'error' && <p role="status">{{
        checking: 'Verificando a tentativa no histórico…',
        missing: 'A partida ainda não apareceu no histórico. Você pode repetir o envio com o mesmo identificador e conteúdo.',
        unknown: 'Não foi possível verificar a tentativa no histórico. Você pode consultar novamente ou repetir o mesmo envio.',
        mismatch: 'O histórico contém dados diferentes para este identificador. A tentativa foi bloqueada.',
      }[reconciliation]}</p>}
      {writer && reconciliation && reconciliation !== 'checking' && saveState === 'error' && <button className="quiet-action" type="button" onClick={() => { setReconciliation('checking'); setLookup(n => n + 1) }}>Consultar tentativa no histórico</button>}
      {saveState === 'error' && reconciliation !== 'checking' ? <button className="quiet-action" type="button" onClick={() => void abandon()}>Abandonar tentativa e editar</button> : null}
      {saveState === 'saved' && onSaved && frozenAttempt ? <button className="quiet-action" type="button" onClick={() => onSaved(frozenAttempt.id)}>Ver partida salva</button> : null}
    </> : null}
  </section>
}

function detailsInput(config: GameConfig): DetailsInput {
  return { ...config, playersOnCourt: String(config.playersOnCourt) }
}

function Details({ initial, onEdit, onContinue }: { initial: DetailsInput; onEdit: (value: DetailsInput) => void; onContinue: (value: GameConfig) => void }) {
  const mode = initial.drawMode ?? 'classic'
  function read(form: FormData): DetailsInput {
    return {
      name: stringValue(form, 'name'), matchDate: stringValue(form, 'matchDate'), matchTime: stringValue(form, 'matchTime'),
      playersOnCourt: stringValue(form, 'playersOnCourt'), teamCount: Number(form.get('teamCount')),
      drawMode: stringValue(form, 'drawMode') as DrawMode,
      ...(form.get('avoidRecentRepeats') === 'on' ? { avoidRecentRepeats: true } : {}),
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = read(new FormData(event.currentTarget))
    onContinue({ ...value, playersOnCourt: Number(value.playersOnCourt) })
  }
  return <form className="data-form" onChange={event => onEdit(read(new FormData(event.currentTarget)))} onSubmit={submit}>
    <label><span className="field-label">Nome <span>(opcional)</span></span><input name="name" defaultValue={initial.name} minLength={2} maxLength={80} placeholder="Ex.: Futebol de quinta" /></label>
    <div className="form-grid">
      <label>Data<input name="matchDate" type="date" defaultValue={initial.matchDate} required /></label>
      <label><span className="field-label">Horário <span>(opcional)</span></span><input name="matchTime" type="time" defaultValue={initial.matchTime} /></label>
    </div>
    <div className="form-grid">
      <label>Times<select aria-label="Times" name="teamCount" defaultValue={initial.teamCount}><option value={2}>2 times</option><option value={3}>3 times</option></select></label>
      <label>Em quadra por time<input name="playersOnCourt" type="number" min="1" max="20" defaultValue={initial.playersOnCourt} required /></label>
    </div>
    <label>Modo de sorteio
      <select name="drawMode" defaultValue={mode} aria-describedby="draw-mode-description">
        {Object.entries(DRAW_MODES).map(([value, option]) => <option key={value} value={value}>{option.label}</option>)}
      </select>
    </label>
    <p id="draw-mode-description" className="game-flow-note">{DRAW_MODES[mode].description}</p>
    {mode !== 'classic' && <div>
      <label className="draw-player-option"><input type="checkbox" name="avoidRecentRepeats" defaultChecked={Boolean(initial.avoidRecentRepeats)} aria-describedby="draw-history-description" />Evitar repetições recentes</label>
      <p className="game-flow-note" id="draw-history-description">Considera até 10 partidas do grupo para variar as duplas. As regras obrigatórias e o equilíbrio dos times continuam prioritários.</p>
    </div>}
    <button className="solid-action" type="submit">Selecionar participantes</button>
  </form>
}

function Participants({ busy, config, error, players, selected, rules, rulesNotice, onRulesChange, onBack, onDraw, onSelectedChange }: { busy: boolean; config: GameConfig; error: string | null; players: Player[]; selected: string[]; rules: DrawRule[]; rulesNotice: string | null; onRulesChange: (rules: DrawRule[]) => Promise<boolean>; onBack: () => void; onDraw: () => void; onSelectedChange: (ids: string[]) => void }) {
  const [query, setQuery] = useState('')
  const visible = searchPlayers(players, query)
  const visibleIds = new Set(visible.map(p => p.id))
  const filtering = query.trim().length > 0
  if (players.length === 0) return <div className="empty-list"><p>Nenhum jogador ativo disponível.</p><span>Cadastre ou reative jogadores no elenco antes de criar o jogo.</span><button className="quiet-action" type="button" onClick={onBack}>Voltar à configuração</button></div>
  const toggle = (id: string, checked: boolean) => onSelectedChange(checked ? [...selected, id] : selected.filter((entry) => entry !== id))
  return <div className="game-participants">
    <p className="game-summary">{config.teamCount} times · {config.playersOnCourt} em quadra por time · {DRAW_MODES[config.drawMode ?? 'classic'].label}</p>
    {config.avoidRecentRepeats && <p className="game-flow-note">Evitar repetições recentes está ativado.</p>}
    <label className="search-field">Buscar participantes<input type="search" value={query} maxLength={80} placeholder="Nome ou apelido" disabled={busy} onChange={event => { event.stopPropagation(); setQuery(event.target.value) }} /></label>
    <div className="draw-actions">
      <button className="quiet-action" type="button" disabled={busy || !visible.length} onClick={() => onSelectedChange([...new Set([...selected, ...visible.map(p => p.id)])])}>{filtering ? `Selecionar encontrados (${visible.length})` : 'Selecionar todos'}</button>
      <button className="quiet-action" type="button" disabled={busy} onClick={() => onSelectedChange(filtering ? selected.filter(id => !visibleIds.has(id)) : [])}>{filtering ? 'Desmarcar encontrados' : 'Limpar seleção'}</button>
    </div>
    <fieldset className="draw-controls" disabled={busy}><legend>Jogadores ativos</legend>{visible.map(p => <label className={`draw-player-option${selected.includes(p.id) ? ' is-selected' : ''}`} key={p.id}>
      <input type="checkbox" checked={selected.includes(p.id)} onChange={event => toggle(p.id, event.target.checked)} />
      <span>{p.nickname || p.name} · Nível {Number(p.skill_rating).toFixed(1)}{p.is_goalkeeper ? ' · Goleiro' : ''}{p.nickname ? <small className="player-full-name">{p.name}</small> : null}</span>
    </label>)}</fieldset>
    {!visible.length ? <p role="status">Nenhum jogador encontrado. Tente outro nome ou apelido.</p> : null}
    <p className="selection-count" aria-live="polite">{selected.length} jogadores selecionados{filtering ? ` · ${visible.length} encontrados` : ''}</p>
    {filtering && selected.some(id => !visibleIds.has(id)) ? <p className="game-flow-note">A busca não remove os jogadores já selecionados fora deste filtro.</p> : null}
    {rulesNotice && <p role="status">{rulesNotice}</p>}
    <RulesEditor rules={rules} players={players.filter(player => selected.includes(player.id))} teamCount={config.teamCount} busy={busy} onChange={onRulesChange} />
    <p className="game-flow-note">Mínimo de {config.teamCount} participantes. Todos entram em um time; times incompletos e reservas são permitidos.</p>
    {error ? <p className="form-status" role="alert">{error}</p> : null}
    <div className="game-flow-actions"><button className="quiet-action" type="button" disabled={busy} onClick={onBack}>Voltar</button><button className="solid-action" type="button" disabled={busy || selected.length < config.teamCount} onClick={onDraw}>{busy ? 'Sorteando…' : 'Sortear times'}</button></div>
  </div>
}

function Results({ config, players, original, state, rules, busy, locked, error, onChange, onReroll, onEditGame, onEditParticipants }: { config: GameConfig; players: Player[]; original: DrawResult; state: AdjustmentState; rules: DrawRule[]; busy: boolean; locked: boolean; error: string | null; onChange: (state: AdjustmentState) => void; onReroll: () => void; onEditGame: () => void; onEditParticipants: () => void }) {
  const [selected, setSelected] = useState<SelectedPlayer>(null)
  const [dragging, setDragging] = useState<SelectedPlayer>(null)
  const [notice, setNotice] = useState<{ seed: string; message: string } | null>(null)
  const drawPlayers = new Map(players.map((player) => [player.id, toDrawPlayer(player)]))
  const adjusted = !sameTeams(state, editableResult(original, config.playersOnCourt))
  const mode = DRAW_MODES[modeForVersion(original.algorithmVersion) ?? 'classic']
  const metrics = state.teams.map(team => teamMetrics(team, drawPlayers))
  const rosterGap = meanGap(metrics.map(team => team.rosterMean))
  const starterGap = meanGap(metrics.map(team => team.starterMean))
  const resultHeading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { resultHeading.current?.focus() }, [original.seed])
  const name = (id: string) => players.find(player => player.id === id)?.name ?? id
  function apply(action: ReturnType<typeof movePlayer>) {
    if (busy || locked) return
    if (!action.ok) {
      setNotice({ seed: original.seed, message: action.message })
      return
    }
    const violation = brokenRule(rules, action.state.teams)
    if (violation) {
      setNotice({ seed: original.seed, message: 'O ajuste viola a regra ' + describeRule(violation, name, TEAM_NAMES) + '. Volte aos participantes para revisar ou remover a regra.' })
      return
    }
    if (rules.length && config.drawMode !== 'classic') {
      const keeperCounts = action.state.teams.map(team => team.playerIds.filter(id => drawPlayers.get(id)?.isGoalkeeper).length)
      if (meanGap(keeperCounts) > 1) {
        setNotice({ seed: original.seed, message: 'O ajuste deixaria a distribuição de goleiros desigual entre os times.' })
        return
      }
    }
    onChange(action.state); setSelected(null); setDragging(null)
    setNotice({ seed: original.seed, message: 'Ajuste aplicado. As métricas foram atualizadas.' }); resultHeading.current?.focus()
  }
  function dropOnTeam(event: DragEvent<HTMLElement>, teamIndex: number) { event.preventDefault(); if (dragging) apply(movePlayer(state, dragging.teamIndex, dragging.id, teamIndex, drawPlayers)); setDragging(null) }
  function dropOnPlayer(event: DragEvent<HTMLElement>, teamIndex: number, playerId: string) { event.preventDefault(); event.stopPropagation(); if (dragging && (dragging.teamIndex !== teamIndex || dragging.id !== playerId)) apply(swapPlayers(state, dragging.teamIndex, dragging.id, teamIndex, playerId, drawPlayers)); setDragging(null) }
  return <section aria-label="Resultado do sorteio" aria-live="polite" className="draw-result"><div className="result-title"><div><h3 ref={resultHeading} tabIndex={-1}>{config.name.trim() || 'Jogo sem nome'}</h3><p>{formatDate(config.matchDate)}{config.matchTime ? ` · ${config.matchTime}` : ''} · {config.teamCount} times</p></div><button className="quiet-action" type="button" disabled={busy} onClick={() => { setSelected(null); setDragging(null); onReroll() }}>{busy ? 'Sorteando…' : 'Novo sorteio'}</button></div><p><strong>{mode.label}</strong> · {mode.description}</p>{rules.length > 0 && <p>{rules.length} regra(s) ativa(s). Você pode revisá-las na etapa de participantes.</p>}<p>{adjusted ? 'Ajustado manualmente · ' : ''}Diferença entre médias gerais: {rosterGap.toFixed(2)} · Diferença entre médias dos titulares: {starterGap.toFixed(2)}.</p><p className="game-flow-note">Arraste um jogador sobre outro para trocar os times. No celular ou com teclado, selecione um jogador e use os botões de troca ou de titulares/reservas.</p>{notice?.seed === original.seed ? <p className="adjustment-status" role="status">{notice.message}</p> : null}{error ? <p className="form-status" role="alert">{error}</p> : null}<div className="draw-teams">{state.teams.map((team, index) => <Team key={TEAM_NAMES[index]} team={team} metrics={metrics[index]!} index={index} players={players} selected={selected} onSelect={setSelected} onDrag={setDragging} onDropTeam={dropOnTeam} onDropPlayer={dropOnPlayer} onApply={apply} state={state} drawPlayers={drawPlayers} />)}</div><p className="game-flow-note">Confira a escalação final antes de salvar e aceitar.</p><div className="game-flow-actions"><button className="quiet-action" type="button" onClick={onEditGame}>Editar jogo</button><button className="solid-action" type="button" onClick={onEditParticipants}>Voltar aos participantes</button></div></section>
}

function Team({ team, metrics, index, players, selected, onSelect, onDrag, onDropTeam, onDropPlayer, onApply, state, drawPlayers }: { team: AdjustmentState['teams'][number]; metrics: ReturnType<typeof teamMetrics>; index: number; players: Player[]; selected: SelectedPlayer; onSelect: (value: SelectedPlayer) => void; onDrag: (value: SelectedPlayer) => void; onDropTeam: (event: DragEvent<HTMLElement>, index: number) => void; onDropPlayer: (event: DragEvent<HTMLElement>, index: number, id: string) => void; onApply: (result: ReturnType<typeof movePlayer>) => void; state: AdjustmentState; drawPlayers: Map<string, DrawPlayer> }) {
  const { court, rosterMean, starterMean, goalkeeperCount, sum } = metrics
  const reserves = team.reserveIds
  const missing = Math.max(0, state.playersOnCourt - team.playerIds.length)
  return <TeamCard name={`Time ${TEAM_NAMES[index]}`} summary={`${team.playerIds.length} jogadores · Média geral ${rosterMean.toFixed(2)} · Média dos titulares ${starterMean.toFixed(2)} · ${goalkeeperCount} goleiro(s) · ${reserves.length} reserva(s)`} onDragOver={event => event.preventDefault()} onDrop={event => onDropTeam(event, index)}>{selected && selected.teamIndex !== index ? <button className="quiet-action" type="button" onClick={() => onApply(movePlayer(state, selected.teamIndex, selected.id, index, drawPlayers))}>Mover selecionado para este time</button> : null}<p className="game-flow-note">Soma dos níveis: {sum.toFixed(1)}</p>{goalkeeperCount === 0 ? <p className="team-warning">Sem goleiro disponível neste time.</p> : null}{missing > 0 ? <p className="team-warning">{team.playerIds.length}/{state.playersOnCourt} em quadra — precisa de {missing} jogador(es) emprestado(s)</p> : null}<Roster title="Em quadra" ids={court} teamIndex={index} players={players} selected={selected} onSelect={onSelect} onDrag={onDrag} onDropPlayer={onDropPlayer} onApply={onApply} state={state} drawPlayers={drawPlayers} /><Roster title="Reservas" ids={reserves} teamIndex={index} players={players} selected={selected} onSelect={onSelect} onDrag={onDrag} onDropPlayer={onDropPlayer} onApply={onApply} state={state} drawPlayers={drawPlayers} /></TeamCard>
}

function Roster({ title, ids, teamIndex, players, selected, onSelect, onDrag, onDropPlayer, onApply, state, drawPlayers }: { title: string; ids: string[]; teamIndex: number; players: Player[]; selected: SelectedPlayer; onSelect: (value: SelectedPlayer) => void; onDrag: (value: SelectedPlayer) => void; onDropPlayer: (event: DragEvent<HTMLElement>, index: number, id: string) => void; onApply: (result: ReturnType<typeof movePlayer>) => void; state: AdjustmentState; drawPlayers: Map<string, DrawPlayer> }) {
  return <section className="team-roster" aria-label={`${title} do Time ${TEAM_NAMES[teamIndex]}`}><h4>{title}</h4><ul>{ids.map((id) => { const player = players.find((entry) => entry.id === id)!; const isSelected = selected?.teamIndex === teamIndex && selected.id === id; const counterpart = selected && selected.teamIndex === teamIndex && selected.id !== id ? selected.id : null; return <li key={id} className={isSelected ? 'selected-player' : ''} draggable onDragStart={(event) => { event.dataTransfer.setData('text/plain', id); event.dataTransfer.effectAllowed = 'move'; onDrag({ teamIndex, id }) }} onDragEnd={() => onDrag(null)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => onDropPlayer(event, teamIndex, id)}><span>{playerName(player)} · Nível {Number(player.skill_rating).toFixed(1)}{player.is_goalkeeper ? ' · Goleiro' : ''}</span><div className="player-adjustments"><button className="quiet-action" type="button" aria-label={`${isSelected ? 'Cancelar ajuste de' : 'Selecionar para ajuste'} ${playerName(player)}`} aria-pressed={isSelected} onClick={() => onSelect(isSelected ? null : { teamIndex, id })}>{isSelected ? 'Cancelar ajuste' : 'Selecionar para ajuste'}</button>{selected && selected.teamIndex !== teamIndex ? <button className="quiet-action" type="button" onClick={() => onApply(swapPlayers(state, selected.teamIndex, selected.id, teamIndex, id, drawPlayers))}>Trocar com selecionado</button> : null}{counterpart ? <button className="quiet-action" type="button" onClick={() => onApply(swapCourtStatus(state, teamIndex, counterpart, id, drawPlayers))}>Trocar titular/reserva</button> : null}</div></li> })}</ul></section>
}

function stringValue(form: FormData, name: string): string { const value = form.get(name); return typeof value === 'string' ? value : '' }
function formatDate(value: string): string { if (!value) return 'Data não informada'; const [year, month, day] = value.split('-'); return `${day}/${month}/${year}` }
function toDrawPlayer(player: Player) { return { id: player.id, skillRating: Number(player.skill_rating), isGoalkeeper: player.is_goalkeeper, preferredPosition: player.preferred_position } }
function playerName(player: Player) { return player.nickname || player.name }
function newSeed() { return Array.from(crypto.getRandomValues(new Uint32Array(4)), (word) => word.toString(16).padStart(8, '0')).join('') }
function sameTeams(first: AdjustmentState, second: AdjustmentState) { return JSON.stringify(first.teams) === JSON.stringify(second.teams) }
function teamMetrics(team: AdjustmentState['teams'][number], players: ReadonlyMap<string, DrawPlayer>) {
  const reserves = new Set(team.reserveIds)
  const court = team.playerIds.filter(id => !reserves.has(id))
  const skillSum = (ids: readonly string[]) => ids.reduce((sum, id) => sum + (players.get(id)?.skillRating ?? 0), 0)
  const sum = skillSum(team.playerIds)
  return {
    court, sum,
    rosterMean: sum / team.playerIds.length,
    starterMean: skillSum(court) / court.length,
    goalkeeperCount: team.playerIds.filter(id => players.get(id)?.isGoalkeeper).length,
  }
}
