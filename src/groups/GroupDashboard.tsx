import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { FutebolSupabaseClient } from '../lib/supabase/client'
import { MatchModuleBoundary } from './MatchModuleBoundary'
import {
  createGroup,
  createPlayer,
  loadGroupWorkspace,
  updateGroup,
  updatePlayer,
  type GroupInput,
  type GroupWithRole,
  type Player,
  type PlayerInput,
  type PreferredPosition,
} from './group-service'

const MatchWorkspace = lazy(async () => ({ default: (await import('../matches/MatchWorkspace')).MatchWorkspace }))

interface GroupDashboardProps {
  client: FutebolSupabaseClient | null
  userId: string
  onAttemptChange?: (pending: boolean) => void
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

export function GroupDashboard({ client, userId, onAttemptChange }: GroupDashboardProps) {
  const [groups, setGroups] = useState<GroupWithRole[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showGroupForm, setShowGroupForm] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [editingPlayer, setEditingPlayer] = useState<Player | 'new' | null>(null)
  const [matchAttemptPending, setMatchAttemptPending] = useState(false)
  const [formPending, setFormPending] = useState(false)
  const navigationLocked = matchAttemptPending || formPending
  useEffect(() => { onAttemptChange?.(navigationLocked) }, [navigationLocked, onAttemptChange])

  const refresh = useCallback(async (preferredGroupId?: string) => {
    if (!client) {
      setError('A conexão com o Supabase não está configurada neste ambiente.')
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const data = await loadGroupWorkspace(client, userId)
      setGroups(data.groups)
      setPlayers(data.players)
      setSelectedGroupId((current) => {
        const requested = preferredGroupId ?? current
        return data.groups.some((group) => group.id === requested) ? requested : (data.groups[0]?.id ?? null)
      })
    } catch {
      setError('Não foi possível carregar seus grupos. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }, [client, userId])

  useEffect(() => {
    let cancelled = false

    if (!client) {
      void Promise.resolve().then(() => {
        if (!cancelled) {
          setError('A conexão com o Supabase não está configurada neste ambiente.')
          setLoading(false)
        }
      })
      return () => { cancelled = true }
    }

    void loadGroupWorkspace(client, userId)
      .then((data) => {
        if (cancelled) return
        setGroups(data.groups)
        setPlayers(data.players)
        setSelectedGroupId(data.groups[0]?.id ?? null)
      })
      .catch(() => {
        if (!cancelled) setError('Não foi possível carregar seus grupos. Tente novamente.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [client, userId])

  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? null
  const selectedPlayers = useMemo(
    () => players.filter((player) => player.group_id === selectedGroupId),
    [players, selectedGroupId],
  )
  const canManagePlayers = selectedGroup?.role === 'owner' || selectedGroup?.role === 'admin'

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
            onSaved={async (groupId) => { setShowGroupForm(false); await refresh(groupId) }}
          />
        ) : (
          <button className="solid-action" type="button" onClick={() => setShowGroupForm(true)}>Criar grupo</button>
        )}
      </section>
    )
  }

  return (
    <div className="workspace">
      <section className="workspace-heading">
        <div>
          <p className="eyebrow">Seus grupos</p>
          <h1>Quem joga hoje?</h1>
        </div>
        <button className="icon-action" type="button" aria-label="Criar outro grupo" disabled={navigationLocked} onClick={() => setShowGroupForm((visible) => !visible)}>＋</button>
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
            onSaved={async (groupId) => { setShowGroupForm(false); await refresh(groupId) }}
          />
        </section>
      ) : null}

      <div className="group-switcher" role="group" aria-label="Grupos">
        {groups.map((group) => (
          <button
            aria-pressed={group.id === selectedGroupId}
            disabled={navigationLocked}
            className={group.id === selectedGroupId ? 'group-chip selected' : 'group-chip'}
            key={group.id}
            onClick={() => { setSelectedGroupId(group.id); setEditingPlayer(null); setShowSettings(false) }}
            type="button"
          >
            {group.name}
          </button>
        ))}
      </div>

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

          <MatchModuleBoundary key={selectedGroup.id}><Suspense fallback={<p role="status">Carregando partidas…</p>}>
            <MatchWorkspace key={selectedGroup.id} client={client} group={selectedGroup} players={selectedPlayers} onAttemptChange={setMatchAttemptPending} />
          </Suspense></MatchModuleBoundary>

          <section className="players-section">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Elenco</p>
                <h2>{selectedPlayers.filter((player) => player.active).length} jogadores ativos</h2>
              </div>
              {canManagePlayers ? (
                <button className="solid-action small-action" type="button" disabled={formPending} onClick={() => setEditingPlayer('new')}>Adicionar</button>
              ) : null}
            </div>

            {editingPlayer && canManagePlayers ? (
              <section className="panel compact-panel" aria-label={editingPlayer === 'new' ? 'Novo jogador' : 'Editar jogador'}>
                <PlayerForm
                  key={editingPlayer === 'new' ? 'new' : editingPlayer.id}
                  client={client}
                  groupId={selectedGroup.id}
                  initialValue={editingPlayer === 'new' ? EMPTY_PLAYER : playerToInput(editingPlayer)}
                  playerId={editingPlayer === 'new' ? undefined : editingPlayer.id}
                  onBusyChange={setFormPending}
                  onCancel={() => setEditingPlayer(null)}
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
                {selectedPlayers.map((player) => (
                  <li className={player.active ? 'player-card' : 'player-card inactive'} key={player.id}>
                    <div className="player-avatar" aria-hidden="true">{initials(player.nickname || player.name)}</div>
                    <div className="player-copy">
                      <strong>{player.nickname || player.name}</strong>
                      {player.nickname ? <span>{player.name}</span> : null}
                      <small>{player.is_goalkeeper ? 'Goleiro · ' : ''}Nível {Number(player.skill_rating).toFixed(1)}{player.active ? '' : ' · Inativo'}</small>
                    </div>
                    {canManagePlayers ? (
                      <button className="quiet-action" type="button" disabled={formPending} onClick={() => setEditingPlayer(player)}>Editar</button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  )
}

function GroupForm({ client, groupId, initialValue, onCancel, onSaved, disabled = false, onBusyChange }: {
  client: FutebolSupabaseClient | null
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
    if (!client) return setError('A conexão com o Supabase não está configurada.')
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

function PlayerForm({ client, groupId, initialValue, playerId, onCancel, onSaved, onBusyChange }: {
  client: FutebolSupabaseClient | null
  groupId: string
  initialValue: PlayerInput
  playerId?: string
  onCancel: () => void
  onSaved: () => Promise<void>
  onBusyChange: (pending: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submitting = useRef(false)
  const status = useRef<HTMLParagraphElement>(null)
  useEffect(() => { if (error) status.current?.focus() }, [error])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    if (!client) return setError('A conexão com o Supabase não está configurada.')
    submitting.current = true; setBusy(true); onBusyChange(true)
    setError(null)
    const form = new FormData(event.currentTarget)
    const position = readString(form, 'preferredPosition')
    const input: PlayerInput = {
      active: form.get('active') === 'on',
      isGoalkeeper: form.get('isGoalkeeper') === 'on',
      name: readString(form, 'name'),
      nickname: readString(form, 'nickname'),
      preferredPosition: position ? position as PreferredPosition : null,
      skillRating: Number(form.get('skillRating')),
    }
    try {
      if (playerId) await updatePlayer(client, playerId, input)
      else await createPlayer(client, groupId, input)
      await onSaved()
    } catch {
      setError('Não foi possível salvar o jogador. Confira os dados e tente novamente.')
    } finally {
      submitting.current = false; setBusy(false); onBusyChange(false)
    }
  }

  return (
    <form className="data-form" aria-busy={busy} onSubmit={(event) => void handleSubmit(event)}><fieldset className="form-fields" disabled={busy}>
      <div className="form-heading"><h2>{playerId ? 'Editar jogador' : 'Novo jogador'}</h2><button type="button" className="close-action" aria-label="Fechar" disabled={busy} onClick={onCancel}>×</button></div>
      <label>Nome<input name="name" defaultValue={initialValue.name} minLength={2} maxLength={80} required autoFocus /></label>
      <label>Apelido <span>(opcional)</span><input name="nickname" defaultValue={initialValue.nickname ?? ''} maxLength={40} /></label>
      <div className="form-grid">
        <label>Nível<select aria-label="Nível" name="skillRating" defaultValue={initialValue.skillRating}>{skillOptions()}</select></label>
        <label>Posição<select aria-label="Posição" name="preferredPosition" defaultValue={initialValue.preferredPosition ?? ''}><option value="">Sem preferência</option>{Object.entries(POSITION_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      </div>
      <div className="check-row">
        <label><input type="checkbox" name="isGoalkeeper" defaultChecked={initialValue.isGoalkeeper} /> É goleiro</label>
        <label><input type="checkbox" name="active" defaultChecked={initialValue.active} /> Jogador ativo</label>
      </div>
      {error ? <p ref={status} tabIndex={-1} className="form-status" role="alert">{error}</p> : null}
      <button className="solid-action" type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Salvar jogador'}</button>
    </fieldset></form>
  )
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
