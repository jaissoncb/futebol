import { DraftReadError, DraftStatusMessage } from '../drafts/DraftStatus'
import { isPlayerDraft, type PlayerDraft } from '../drafts/models'
import { draftScope, type DraftAccess, type DraftScope } from '../drafts/store'
import { useDraftAutosave, useDraftRecord, type DraftWriter } from '../drafts/use-draft'
import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import type { FutebolDataClient } from '../lib/data-client'
import { MatchModuleBoundary } from './MatchModuleBoundary'
import { GroupSwitcher } from './GroupSwitcher'
import { readSelectedGroup, rememberSelectedGroup } from './selected-group'
import { searchPlayers } from './player-search'
import { ConfirmationDialog } from '../ConfirmationDialog'
import { useConfirmation } from '../useConfirmation'
import {
  createGroup,
  createPlayer,
  loadGroupWorkspace,
  updateGroup,
  updatePlayer,
  type GroupInput,
  type GroupWorkspaceData,
  type GroupWithRole,
  type Player,
  type PlayerInput,
  type PreferredPosition,
} from './group-service'

const MatchWorkspace = lazy(async () => ({ default: (await import('../matches/MatchWorkspace')).MatchWorkspace }))

interface GroupDashboardProps {
  client: FutebolDataClient | null
  userId: string
  onAttemptChange?: (pending: boolean) => void
  verifiedData?: GroupWorkspaceData
  drafts?: DraftAccess | null
  onGroupsChanged?: () => void
}

const EMPTY_GROUP: GroupInput = { defaultPlayersOnCourt: 5, name: '', sport: 'futsal' }
const EMPTY_PLAYER: PlayerInput = {
  active: true,
  isGoalkeeper: false,
  name: '',
  nickname: null,
  preferredPosition: null,
  skillRating: 3,
}

const POSITION_LABELS: Record<PreferredPosition, string> = {
  goalkeeper: 'Goleiro',
  defense: 'Defesa',
  midfield: 'Meio-campo',
  attack: 'Ataque',
  any: 'Qualquer posição',
}

const ROLE_LABELS = { owner: 'Proprietário', admin: 'Administrador', member: 'Membro' } as const

export function GroupDashboard(props: GroupDashboardProps) {
  return <GroupDashboardContent key={props.userId} {...props} />
}

function GroupDashboardContent({ client, userId, onAttemptChange, verifiedData, drafts, onGroupsChanged }: GroupDashboardProps) {
  const { confirm, dialogProps } = useConfirmation()
  const sectionPrefix = useId()
  const [playerSearch, setPlayerSearch] = useState({ groupId: '', query: '' })
  const [groups, setGroups] = useState<GroupWithRole[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showGroupForm, setShowGroupForm] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [editingPlayer, setEditingPlayer] = useState<Player | 'new' | null>(null)
  const [matchAttemptPending, setMatchAttemptPending] = useState(false)
  const [matchDraftDirty, setMatchDraftDirty] = useState(false)
  const [playerDraftDirty, setPlayerDraftDirty] = useState(false)
  const [formPending, setFormPending] = useState(false)
  const [authorization, setAuthorization] = useState<{ data?: GroupWorkspaceData; version: number }>({ version: 0 })
  if (verifiedData && authorization.data !== verifiedData) {
    setAuthorization({ data: verifiedData, version: authorization.version + 1 })
    setGroups(verifiedData.groups)
    setPlayers(verifiedData.players)
    setError(null)
    setLoading(false)
    if (selectedGroupId && !verifiedData.groups.some(group => group.id === selectedGroupId)) {
      setSelectedGroupId(verifiedData.groups[0]?.id ?? null)
      setEditingPlayer(null)
      setPlayerDraftDirty(false)
      setShowSettings(false)
      setMatchAttemptPending(false)
      setMatchDraftDirty(false)
    } else if (selectedGroupId) {
      const previousRole = groups.find(group => group.id === selectedGroupId)?.role
      const currentRole = verifiedData.groups.find(group => group.id === selectedGroupId)?.role
      if (currentRole === 'member' && previousRole !== 'member') {
        setEditingPlayer(null)
        setPlayerDraftDirty(false)
        setMatchAttemptPending(false)
        setMatchDraftDirty(false)
      }
      if (currentRole !== 'owner') setShowSettings(false)
    }
  }
  const navigationLocked = matchAttemptPending || formPending
  useEffect(() => { onAttemptChange?.(navigationLocked || matchDraftDirty || playerDraftDirty) }, [navigationLocked, matchDraftDirty, playerDraftDirty, onAttemptChange])
  useEffect(() => {
    if (!loading && !error && (selectedGroupId || !verifiedData?.groups.length)) rememberSelectedGroup(userId, selectedGroupId)
  }, [userId, selectedGroupId, loading, error, verifiedData])

  useEffect(() => {
    if (!verifiedData) return
    let cancelled = false
    const preferred = readSelectedGroup(userId)
    void Promise.resolve().then(() => {
      if (!cancelled) setSelectedGroupId(current => current ??
        verifiedData.groups.find(group => group.id === preferred)?.id ?? verifiedData.groups[0]?.id ?? null)
    })
    return () => { cancelled = true }
  }, [userId, verifiedData])

  const refresh = useCallback(async (preferredGroupId?: string) => {
    if (!client) {
      setError('A conexão com o Futebol não está configurada neste ambiente.')
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    try {
      // Creating a group can also request a switch. Cancelling keeps the draft
      // and still refreshes the roster/groups after the successful creation.
      const switchGroup = preferredGroupId && preferredGroupId !== selectedGroupId
      const preferred = switchGroup && matchDraftDirty && drafts === undefined
        && !await confirm({ title: 'Trocar de grupo?', message: 'Há alterações não salvas na partida. Trocar de grupo descarta este rascunho.', action: 'Descartar e trocar de grupo' })
        ? undefined : preferredGroupId
      const data = await loadGroupWorkspace(client)
      setGroups(data.groups)
      setPlayers(data.players)
      if (preferred && preferred !== selectedGroupId && data.groups.some(group => group.id === preferred)) setMatchDraftDirty(false)
      setSelectedGroupId((current) => {
        const requested = preferred ?? current ?? readSelectedGroup(userId)
        return data.groups.some((group) => group.id === requested) ? requested : (data.groups[0]?.id ?? null)
      })
    } catch {
      setError('Não foi possível carregar seus grupos. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }, [client, userId, selectedGroupId, matchDraftDirty, confirm, drafts])

  useEffect(() => {
    if (verifiedData) return
    let cancelled = false

    if (!client) {
      void Promise.resolve().then(() => {
        if (!cancelled) {
          setError('A conexão com o Futebol não está configurada neste ambiente.')
          setLoading(false)
        }
      })
      return () => { cancelled = true }
    }

    void loadGroupWorkspace(client)
      .then((data) => {
        if (cancelled) return
        setGroups(data.groups)
        setPlayers(data.players)
        const preferred = readSelectedGroup(userId)
        setSelectedGroupId(data.groups.find((group) => group.id === preferred)?.id ?? data.groups[0]?.id ?? null)
      })
      .catch(() => {
        if (!cancelled) setError('Não foi possível carregar seus grupos. Tente novamente.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [client, userId, verifiedData])

  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? null
  const selectedPlayers = useMemo(
    () => players.filter((player) => player.group_id === selectedGroupId),
    [players, selectedGroupId],
  )
  const canManagePlayers = selectedGroup?.role === 'owner' || selectedGroup?.role === 'admin'
  const scope = selectedGroup && canManagePlayers ? draftScope(drafts, selectedGroup.id) : null
  const currentPlayer = editingPlayer === 'new' ? editingPlayer : selectedPlayers.find(player => player.id === editingPlayer?.id)
  const query = playerSearch.groupId === selectedGroupId ? playerSearch.query : ''
  const visiblePlayers = searchPlayers(selectedPlayers, query)
  function goTo(section: string) {
    const target = document.getElementById(`${sectionPrefix}-${section}`)
    target?.scrollIntoView?.({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' })
    target?.focus({ preventScroll: true })
  }

  if (loading && groups.length === 0) {
    return <section className="workspace-state" aria-live="polite"><span className="spinner" aria-hidden="true" /><p>Carregando seus grupos…</p></section>
  }

  if (error && groups.length === 0) {
    return (
      <section className="workspace-state error-state" role="alert">
        <h1>Não conseguimos abrir seu espaço.</h1>
        <p>{error}</p>
        <button className="solid-action" type="button" onClick={() => void refresh()}>Tentar novamente</button>
      </section>
    )
  }

  if (groups.length === 0) {
    return (
      <section className="empty-workspace">
        <div className="empty-icon" aria-hidden="true">＋</div>
        <p className="eyebrow">Seu primeiro grupo</p>
        <h1>Monte a sua pelada.</h1>
        <p>Crie um grupo para cadastrar jogadores e deixar tudo pronto para as partidas.</p>
        {showGroupForm ? (
          <GroupForm
            disabled={matchAttemptPending}
            client={client}
            initialValue={EMPTY_GROUP}
            onBusyChange={setFormPending}
            onCancel={() => setShowGroupForm(false)}
            onSaved={async (groupId) => { setShowGroupForm(false); await refresh(groupId); onGroupsChanged?.() }}
          />
        ) : (
          <button className="solid-action" type="button" onClick={() => setShowGroupForm(true)}>Criar grupo</button>
        )}
      </section>
    )
  }

  return (
    <div className="workspace">
      <ConfirmationDialog {...dialogProps} />
      <section className="workspace-heading">
        <div>
          <p className="eyebrow">Seus grupos</p>
          <h1>Quem joga hoje?</h1>
        </div>
        <button className="solid-action new-group-action" type="button" disabled={navigationLocked} onClick={() => setShowGroupForm((visible) => !visible)}>
          <span aria-hidden="true">＋</span><span>Novo grupo</span>
        </button>
      </section>

      {error ? <p className="form-status" role="alert">{error}</p> : null}

      {showGroupForm ? (
        <section className="panel compact-panel" aria-label="Novo grupo">
          <GroupForm
            disabled={matchAttemptPending}
            client={client}
            initialValue={EMPTY_GROUP}
            onBusyChange={setFormPending}
            onCancel={() => setShowGroupForm(false)}
            onSaved={async (groupId) => { setShowGroupForm(false); await refresh(groupId); onGroupsChanged?.() }}
          />
        </section>
      ) : null}

      <GroupSwitcher groups={groups} selectedId={selectedGroupId} disabled={navigationLocked}
        onSelect={id => { void (async () => {
          if (id === selectedGroupId || navigationLocked) return
          if (drafts === undefined && matchDraftDirty && !await confirm({ title: 'Trocar de grupo?', message: 'Há alterações não salvas na partida. Trocar de grupo descarta este rascunho.', action: 'Descartar e trocar de grupo' })) return
          setMatchDraftDirty(false); setSelectedGroupId(id); setEditingPlayer(null); setShowSettings(false)
        })() }} />

      {selectedGroup ? (
        <>
          <section className="group-summary panel">
            <div>
              <span className="role-badge">{ROLE_LABELS[selectedGroup.role]}</span>
              <h2>{selectedGroup.name}</h2>
              <p>{selectedGroup.sport} · {selectedGroup.default_players_on_court} em quadra por time</p>
            </div>
            {selectedGroup.role === 'owner' ? (
              <button className="quiet-action" type="button" disabled={navigationLocked} onClick={() => setShowSettings((visible) => !visible)}>
                {showSettings ? 'Fechar ajustes' : 'Ajustar grupo'}
              </button>
            ) : null}
          </section>

          {showSettings && selectedGroup.role === 'owner' ? (
            <section className="panel compact-panel" aria-label="Ajustes do grupo">
              <GroupForm
            disabled={matchAttemptPending}
                client={client}
                groupId={selectedGroup.id}
                onBusyChange={setFormPending}
                initialValue={{
                  defaultPlayersOnCourt: selectedGroup.default_players_on_court,
                  name: selectedGroup.name,
                  sport: selectedGroup.sport,
                }}
                onCancel={() => setShowSettings(false)}
                onSaved={async () => { setShowSettings(false); await refresh(selectedGroup.id) }}
              />
            </section>
          ) : null}

          <nav className="workspace-nav" aria-label="Navegação do grupo">
            {canManagePlayers ? <button type="button" aria-controls={`${sectionPrefix}-game`} onClick={() => goTo('game')}>Jogar</button> : null}
            <button type="button" aria-controls={`${sectionPrefix}-players`} onClick={() => goTo('players')}>Elenco</button>
            <button type="button" aria-controls={`${sectionPrefix}-history`} onClick={() => goTo('history')}>Histórico</button>
          </nav>
          <MatchModuleBoundary key={selectedGroup.id}><Suspense fallback={<p role="status">Carregando partidas…</p>}>
            <MatchWorkspace key={`${selectedGroup.id}:${canManagePlayers}:${scope?.grant ?? ""}`} client={client} group={selectedGroup} players={selectedPlayers} scope={scope} requireDurable={drafts !== undefined} gameId={`${sectionPrefix}-game`} historyId={`${sectionPrefix}-history`} onAttemptChange={setMatchAttemptPending} onDraftChange={setMatchDraftDirty} authorizationVersion={authorization.version} />
          </Suspense></MatchModuleBoundary>

          <section className="players-section" id={`${sectionPrefix}-players`} tabIndex={-1} aria-label="Elenco do grupo">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Elenco</p>
                <h2>{selectedPlayers.filter((player) => player.active).length} jogadores ativos</h2>
              </div>
              {canManagePlayers ? (
                <button className="solid-action small-action" type="button" disabled={formPending} onClick={() => setEditingPlayer('new')}>Adicionar</button>
              ) : null}
            </div>
            {selectedPlayers.length ? <label className="search-field">Buscar no elenco<input type="search" placeholder="Nome ou apelido" maxLength={80} value={query} onChange={event => setPlayerSearch({ groupId: selectedGroup.id, query: event.target.value })} /></label> : null}

            {canManagePlayers && (scope || currentPlayer === 'new') ? <NewPlayerDraft
              key={scope?.grant ?? selectedGroup.id} scope={scope} client={client} groupId={selectedGroup.id}
              open={currentPlayer === 'new'} hidden={Boolean(currentPlayer && currentPlayer !== 'new')}
              onDirty={setPlayerDraftDirty} onBusyChange={setFormPending}
              onClose={() => setEditingPlayer(null)}
              onSaved={async () => { setEditingPlayer(null); await refresh(selectedGroup.id) }}
            /> : null}
            {currentPlayer && currentPlayer !== 'new' && canManagePlayers ? (
              <section className="panel compact-panel" aria-label="Editar jogador">
                <PlayerForm key={currentPlayer.id} client={client} groupId={selectedGroup.id}
                  initialValue={playerToInput(currentPlayer)} playerId={currentPlayer.id}
                  onBusyChange={setFormPending} onCancel={() => setEditingPlayer(null)}
                  onSaved={async () => { setEditingPlayer(null); await refresh(selectedGroup.id) }}
                />
              </section>
            ) : null}

            {selectedPlayers.length === 0 ? (
              <div className="empty-list">
                <p>Nenhum jogador cadastrado.</p>
                <span>{canManagePlayers ? 'Adicione o primeiro nome do elenco.' : 'Um administrador ainda não cadastrou o elenco.'}</span>
              </div>
            ) : (
              <ul className="player-list">
                {visiblePlayers.map((player) => (
                  <li className={player.active ? 'player-card' : 'player-card inactive'} key={player.id}>
                    <div className="player-avatar" aria-hidden="true">{initials(player.nickname || player.name)}</div>
                    <div className="player-copy">
                      <strong>{player.nickname || player.name}</strong>
                      {player.nickname ? <span>{player.name}</span> : null}
                      <small>{player.is_goalkeeper ? 'Goleiro · ' : ''}Nível {Number(player.skill_rating).toFixed(1)}{player.active ? '' : ' · Inativo'}</small>
                    </div>
                    {canManagePlayers ? (
                      <button className="quiet-action" type="button" aria-label={`Editar ${player.nickname || player.name}`} disabled={formPending} onClick={() => setEditingPlayer(player)}>Editar</button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {selectedPlayers.length > 0 && visiblePlayers.length === 0 ? <p role="status">Nenhum jogador encontrado. Tente outro nome ou apelido.</p> : null}
          </section>
        </>
      ) : null}
    </div>
  )
}

function GroupForm({ client, groupId, initialValue, onCancel, onSaved, disabled = false, onBusyChange }: {
  client: FutebolDataClient | null
  groupId?: string
  disabled?: boolean
  initialValue: GroupInput
  onCancel: () => void
  onSaved: (groupId?: string) => Promise<void>
  onBusyChange?: (pending: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submitting = useRef(false)
  const status = useRef<HTMLParagraphElement>(null)
  useEffect(() => { if (error) status.current?.focus() }, [error])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || disabled) return
    if (!client) return setError('A conexão com o Futebol não está configurada neste ambiente.')
    submitting.current = true; setBusy(true); onBusyChange?.(true)
    setError(null)
    const form = new FormData(event.currentTarget)
    const input: GroupInput = {
      defaultPlayersOnCourt: Number(form.get('defaultPlayersOnCourt')),
      name: readString(form, 'name'),
      sport: readString(form, 'sport'),
    }
    try {
      const savedGroupId = groupId ? (await updateGroup(client, groupId, input), groupId) : await createGroup(client, input)
      await onSaved(savedGroupId)
    } catch {
      setError('Não foi possível salvar o grupo. Confira os dados e tente novamente.')
    } finally {
      submitting.current = false; setBusy(false); onBusyChange?.(false)
    }
  }

  return (
    <form className="data-form" aria-busy={busy} onSubmit={(event) => void handleSubmit(event)}><fieldset className="form-fields" disabled={busy}>
      <div className="form-heading"><h2>{groupId ? 'Ajustes do grupo' : 'Novo grupo'}</h2><button type="button" className="close-action" aria-label="Fechar" disabled={busy} onClick={onCancel}>×</button></div>
      <label>Nome<input name="name" defaultValue={initialValue.name} minLength={2} maxLength={80} required autoFocus /></label>
      <div className="form-grid">
        <label>Esporte<input name="sport" defaultValue={initialValue.sport} minLength={2} maxLength={40} required /></label>
        <label>Por time<input name="defaultPlayersOnCourt" defaultValue={initialValue.defaultPlayersOnCourt} type="number" min="1" max="20" required /></label>
      </div>
      {error ? <p ref={status} tabIndex={-1} className="form-status" role="alert">{error}</p> : null}
      <button className="solid-action" type="submit" disabled={busy || disabled}>{busy ? 'Salvando…' : 'Salvar grupo'}</button>
    </fieldset></form>
  )
}

function NewPlayerDraft({ scope, client, groupId, open, hidden, onDirty, onBusyChange, onClose, onSaved }: {
  scope: DraftScope | null; client: FutebolDataClient | null; groupId: string; open: boolean; hidden: boolean
  onDirty: (dirty: boolean) => void; onBusyChange: (busy: boolean) => void; onClose: () => void; onSaved: () => Promise<void>
}) {
  const { record, status, reload, discardCorrupt } = useDraftRecord(scope, 'player', isPlayerDraft)
  const [created, setCreated] = useState(false)
  const [review, setReview] = useState<Player[] | null>(null)
  const [reviewBusy, setReviewBusy] = useState(false)
  const [reviewError, setReviewError] = useState(false)
  const [resumed, setResumed] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) { setWasOpen(open); if (open) setDismissed(false) }
  const visible = created || open || (record.state === 'ready' && record.initial && !dismissed)
  useEffect(() => () => onDirty(false), [onDirty])
  if (record.state === 'error') return <DraftReadError issue={record.issue} onRetry={reload} onDiscard={() => void discardCorrupt()} />
  if (!visible) return null
  if (record.state === 'loading') return <p role="status">Abrindo rascunho de jogador…</p>
  const writer = record.writer
  async function clear() {
    if (writer && !await writer.commit(null)) return false
    setCreated(false); setReview(null); setResumed(false); setDismissed(true); onDirty(false)
    if (writer) reload()
    return true
  }
  async function checkRoster() {
    if (!client || reviewBusy) return
    setReviewBusy(true); setReviewError(false)
    try {
      const workspace = await loadGroupWorkspace(client)
      if (!workspace.groups.some(group => group.id === groupId && (group.role === 'owner' || group.role === 'admin'))) {
        setReviewError(true)
        return
      }
      setReview(workspace.players.filter(player => player.group_id === groupId))
    } catch { setReviewError(true) }
    finally { setReviewBusy(false) }
  }
  const needsReview = record.initial?.submitted && !resumed
  return <section className="panel compact-panel" aria-label="Novo jogador" hidden={hidden}>
    {created ? <p role="alert">Jogador cadastrado. Não foi possível limpar o rascunho deste dispositivo.</p> : null}
    <DraftStatusMessage status={status} onReload={created || needsReview ? undefined : reload} />
    {created ? <button type="button" onClick={() => void clear().then(cleared => { if (cleared) onClose() })}>Tentar limpar rascunho</button>
      : needsReview ? <div>
        <p role="alert">O cadastro de {record.initial?.name} pode já ter sido enviado. Confira o elenco do grupo antes de continuar.</p>
        <button type="button" disabled={reviewBusy} onClick={() => void checkRoster()}>Conferir elenco atualizado</button>
        {reviewError && <p role="alert">Não foi possível confirmar o elenco autorizado. Tente novamente.</p>}
        {review && <>
          <ul aria-label="Elenco atualizado">{review.map(player => <li key={player.id}>
            {player.name}{player.nickname ? ' · ' + player.nickname : ''} · Nível {player.skill_rating}{player.active ? '' : ' · Inativo'}
          </li>)}</ul>
          {review.length === 0 && <p>O grupo ainda não tem jogadores.</p>}
          <button type="button" onClick={() => void clear().then(cleared => { if (cleared) onClose() })}>Descartar cadastro recuperado</button>
          <button type="button" onClick={() => setResumed(true)}>Conferi o elenco e quero continuar o cadastro</button>
        </>}
      </div> :
    <PlayerForm client={client} groupId={groupId} initialValue={record.initial ?? EMPTY_PLAYER} writer={writer}
      onDirty={onDirty} onBusyChange={onBusyChange}
      onCancel={() => void clear().then(cleared => { if (cleared) onClose() })}
      onSaved={async () => {
        if (!await clear()) setCreated(true)
        await onSaved()
      }} />}
  </section>
}

function PlayerForm({ client, groupId, initialValue, playerId, writer, onDirty, onCancel, onSaved, onBusyChange }: {
  client: FutebolDataClient | null
  groupId: string
  initialValue: PlayerDraft
  writer?: DraftWriter<PlayerDraft>
  onDirty?: (dirty: boolean) => void
  playerId?: string
  onCancel: () => void
  onSaved: () => Promise<void>
  onBusyChange: (pending: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<PlayerDraft | null>(null)
  const [saved, setSaved] = useState(false)
  useDraftAutosave(writer, draft, 180)
  const submitting = useRef(false)
  const status = useRef<HTMLParagraphElement>(null)
  useEffect(() => { if (error) status.current?.focus() }, [error])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || saved) return
    if (!client) return setError('A conexão com o Futebol não está configurada neste ambiente.')
    submitting.current = true; setBusy(true); onBusyChange(true)
    setError(null)
    const input = playerFormInput(event.currentTarget)
    try {
      if (writer && !await writer.commit({ ...input, submitted: true })) {
        setError('Não foi possível guardar a versão atual do formulário. O cadastro não foi enviado.')
        return
      }
      if (playerId) await updatePlayer(client, playerId, input)
      else await createPlayer(client, groupId, input)
      setSaved(true)
      await onSaved()
    } catch {
      setError('Não foi possível salvar o jogador. Confira os dados e tente novamente.')
    } finally {
      submitting.current = false; setBusy(false); onBusyChange(false)
    }
  }

  return (
    <form className="data-form" aria-busy={busy} onChange={event => { if (writer) { setDraft({ ...playerFormInput(event.currentTarget), ...(initialValue.submitted && { submitted: true }) }); onDirty?.(true) } }} onSubmit={(event) => void handleSubmit(event)}><fieldset className="form-fields" disabled={busy || saved}>
      <div className="form-heading"><h2>{playerId ? 'Editar jogador' : 'Novo jogador'}</h2><button type="button" className="close-action" aria-label="Fechar" disabled={busy} onClick={onCancel}>×</button></div>
      <label>Nome<input name="name" defaultValue={initialValue.name} minLength={2} maxLength={80} required autoFocus /></label>
      <label><span className="field-label">Apelido <span>(opcional)</span></span><input name="nickname" defaultValue={initialValue.nickname ?? ''} maxLength={40} /></label>
      <div className="form-grid">
        <label>Nível<select aria-label="Nível" name="skillRating" defaultValue={initialValue.skillRating}>{skillOptions()}</select></label>
        <label>Posição<select aria-label="Posição" name="preferredPosition" defaultValue={initialValue.preferredPosition ?? ''}><option value="">Sem preferência</option>{Object.entries(POSITION_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      </div>
      <div className="check-row">
        <label><input type="checkbox" name="isGoalkeeper" defaultChecked={initialValue.isGoalkeeper} /> É goleiro</label>
        <label><input type="checkbox" name="active" defaultChecked={initialValue.active} /> Jogador ativo</label>
      </div>
      {error ? <p ref={status} tabIndex={-1} className="form-status" role="alert">{error}</p> : null}
      <button className="solid-action" type="submit" disabled={busy || saved}>{saved ? 'Jogador salvo' : busy ? 'Salvando…' : 'Salvar jogador'}</button>
    </fieldset></form>
  )
}

function playerFormInput(formElement: HTMLFormElement): PlayerInput {
  const form = new FormData(formElement)
  const position = readString(form, 'preferredPosition')
  return {
    active: form.get('active') === 'on',
    isGoalkeeper: form.get('isGoalkeeper') === 'on',
    name: readString(form, 'name'),
    nickname: readString(form, 'nickname'),
    preferredPosition: position ? position as PreferredPosition : null,
    skillRating: Number(form.get('skillRating')),
  }
}

function playerToInput(player: Player): PlayerInput {
  return {
    active: player.active,
    isGoalkeeper: player.is_goalkeeper,
    name: player.name,
    nickname: player.nickname,
    preferredPosition: player.preferred_position,
    skillRating: Number(player.skill_rating),
  }
}

function skillOptions() {
  return Array.from({ length: 9 }, (_, index) => 1 + index * 0.5).map((value) => <option value={value} key={value}>{value.toFixed(1)}</option>)
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
}

function readString(form: FormData, name: string): string {
  const value = form.get(name)
  return typeof value === 'string' ? value : ''
}
