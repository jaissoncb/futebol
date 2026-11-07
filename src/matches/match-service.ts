import { type FutebolDataClient } from '../lib/data-client'
import type { Tables } from '../lib/database.types'
import type { SaveDrawPayload } from './draw-payload'
import { validateAdjustment } from '../draw/adjustments'

export type SavedMatch = {
  match: Tables<'matches'>; participants: Tables<'match_players'>[]; teams: Tables<'teams'>[]
  assignments: Tables<'team_assignments'>[]; runs: Tables<'draw_runs'>[]
}
export const HISTORY_PAGE_SIZE = 50

export async function saveMatchDraw(client: FutebolDataClient, id: string, payload: SaveDrawPayload): Promise<string> {
  return client.saveDraw(id, payload)
}

export async function loadMatchHistory(client: FutebolDataClient, groupId: string, page = 0) {
  return client.history(groupId, page)
}

/** Read one authorized graph snapshot through the API, never the current roster. */
export async function loadSavedMatch(client: FutebolDataClient, groupId: string, id: string): Promise<SavedMatch> {
  return client.savedMatch(groupId, id)
}

export function validateSavedMatch(saved: SavedMatch): SavedMatch {
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
