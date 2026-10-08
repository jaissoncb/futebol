import type { FutebolSupabaseClient } from '../lib/supabase/client'
import type { Tables } from '../lib/supabase/database.types'
import type { SaveDrawPayload } from './draw-payload'
import { validateAdjustment } from '../draw/adjustments'

export type SavedMatch = {
  match: Tables<'matches'>; participants: Tables<'match_players'>[]; teams: Tables<'teams'>[]
  assignments: Tables<'team_assignments'>[]; runs: Tables<'draw_runs'>[]
}
export const HISTORY_PAGE_SIZE = 50
export const SAVE_TIMEOUT_MS = 20_000

export async function saveMatchDraw(client: FutebolSupabaseClient, id: string, payload: SaveDrawPayload): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SAVE_TIMEOUT_MS)
  try {
    const { data, error } = await client.rpc('save_match_draw', { target_match_id: id, payload }).abortSignal(controller.signal)
    if (error) throw error
    if (data !== id) throw new Error('Resposta de salvamento inválida.')
    return data
  } finally { clearTimeout(timeout) }
}

export async function loadMatchHistory(client: FutebolSupabaseClient, groupId: string, page = 0) {
  const { data, error } = await client.from('matches').select('*').eq('group_id', groupId).eq('status', 'drawn')
    .order('match_date', { ascending: false }).order('match_time', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false }).order('id', { ascending: false })
    .range(page * HISTORY_PAGE_SIZE, (page + 1) * HISTORY_PAGE_SIZE - 1)
  if (error) throw error
  return data ?? []
}

/** Scoped, RLS-protected reads. Historical data never comes from players. */
export async function loadSavedMatch(client: FutebolSupabaseClient, groupId: string, id: string): Promise<SavedMatch> {
  const [m, p, t, a, r] = await Promise.all([
    client.from('matches').select('*').eq('group_id', groupId).eq('id', id).eq('status', 'drawn').single(),
    client.from('match_players').select('*').eq('group_id', groupId).eq('match_id', id).order('player_name_snapshot'),
    client.from('teams').select('*').eq('group_id', groupId).eq('match_id', id).order('team_index'),
    client.from('team_assignments').select('*').eq('group_id', groupId).eq('match_id', id),
    client.from('draw_runs').select('*').eq('group_id', groupId).eq('match_id', id).order('run_number'),
  ])
  const error = m.error ?? p.error ?? t.error ?? a.error ?? r.error
  if (error) throw error
  if (!m.data) throw new Error('Partida indisponível.')
  const saved = { match: m.data, participants: p.data ?? [], teams: t.data ?? [], assignments: a.data ?? [], runs: r.data ?? [] }
  const participantIds = new Set(saved.participants.map((row) => row.player_id))
  const teamIds = new Set(saved.teams.map((row) => row.id))
  if (saved.match.status !== 'drawn' || saved.teams.length !== saved.match.team_count || saved.participants.length === 0
    || saved.assignments.length !== saved.participants.length || saved.runs.filter((run) => run.accepted).length !== 1
    || !saved.runs.at(-1)?.accepted || new Set(saved.assignments.map((row) => row.player_id)).size !== saved.participants.length
    || participantIds.size !== saved.participants.length || teamIds.size !== saved.teams.length
    || saved.participants.some((row) => row.attendance_status !== 'present')
    || saved.teams.some((row, index) => row.team_index !== index + 1)
    || saved.runs.some((row, index) => row.run_number !== index + 1)
    || saved.assignments.some((row) => !participantIds.has(row.player_id) || !teamIds.has(row.team_id))) throw new Error('Resultado salvo incompleto.')
  const lineup = { playersOnCourt: saved.match.players_on_court, teams: saved.teams.map((team) => ({
    playerIds: saved.assignments.filter((row) => row.team_id === team.id).map((row) => row.player_id),
    reserveIds: saved.assignments.filter((row) => row.team_id === team.id && row.starts_as_reserve).map((row) => row.player_id),
  })) }
  const drawPlayers = new Map(saved.participants.map((row) => [row.player_id, {
    id: row.player_id, skillRating: Number(row.skill_rating_snapshot), isGoalkeeper: row.is_goalkeeper_snapshot,
  }]))
  if (lineup.teams.some((team) => !team.playerIds.length) || validateAdjustment(lineup, drawPlayers)) throw new Error('Resultado salvo incompleto.')
  return saved
}
