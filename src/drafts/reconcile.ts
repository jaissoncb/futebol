import { loadSavedMatch, type SavedMatch } from '../matches/match-service'
import type { FutebolDataClient } from '../lib/data-client'
import { ApiError } from '../lib/api/client'
import type { DrawAttempt } from './models'

function sameMatch(saved: SavedMatch, { id, payload }: DrawAttempt, userId: string) {
  const { match, participants, teams, assignments, runs } = saved
  if (match.id !== id || match.group_id !== payload.group_id || match.created_by !== userId
    || match.name !== payload.name || match.match_date !== payload.match_date
    || match.match_time !== (payload.match_time ? payload.match_time + ':00' : null)
    || match.team_count !== payload.team_count || match.players_on_court !== payload.players_on_court
    || participants.length !== payload.participants.length || teams.length !== payload.teams.length
    || assignments.length !== payload.assignments.length || runs.length !== payload.draw_runs.length) return false
  const byPlayer = new Map(participants.map(row => [row.player_id, row]))
  const lineup = new Map(assignments.map(row => [row.player_id, row]))
  const teamIds = new Map(teams.map(row => [row.team_index, row]))
  return payload.participants.every(p => {
    const row = byPlayer.get(p.player_id)
    return row?.player_name_snapshot === p.player_name_snapshot && row.player_nickname_snapshot === p.player_nickname_snapshot
      && Number(row.skill_rating_snapshot) === p.skill_rating_snapshot && row.is_goalkeeper_snapshot === p.is_goalkeeper_snapshot
      && row.preferred_position_snapshot === p.preferred_position_snapshot
  }) && payload.teams.every(team => {
    const row = teamIds.get(team.team_index)
    return row?.name === team.name && row.color === team.color
  }) && payload.assignments.every(a => {
    const row = lineup.get(a.player_id)
    return row && row.team_id === teamIds.get(a.team_index)?.id && row.starts_as_reserve === a.starts_as_reserve
      && row.assignment_source === a.assignment_source
  }) && payload.draw_runs.every((run, index) => {
    const row = runs[index]
    return row?.run_number === run.run_number && row.seed === run.seed && row.algorithm_version === run.algorithm_version
      && row.balance_score !== null && Number(row.balance_score) === Math.round((run.balance_score + Number.EPSILON) * 1000) / 1000
      && row.accepted === run.accepted
  })
}

export async function reconcileAttempt(client: FutebolDataClient, attempt: DrawAttempt, userId: string) {
  try {
    const saved = await loadSavedMatch(client, attempt.payload.group_id, attempt.id)
    return sameMatch(saved, attempt, userId) ? 'saved' : 'mismatch'
  } catch (error) {
    return error instanceof ApiError && error.kind === 'http' && error.status === 404 ? 'missing' : 'unknown'
  }
}
