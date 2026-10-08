import type { GroupWithRole, Player } from '../groups/group-service'
import { drawTeams } from '../draw/engine'
import { buildDrawPayload, type GameConfig } from './draw-payload'
import type { SavedMatch } from './match-service'

export const group: GroupWithRole = { id: 'a0000000-0000-0000-0000-000000000001', name: 'Grupo fictício', role: 'owner', sport: 'futsal', default_players_on_court: 1, created_by: 'user', created_at: '', updated_at: '' }
export const players: Player[] = Array.from({ length: 4 }, (_, i) => ({ id: `b0000000-0000-0000-0000-00000000000${i + 1}`, group_id: group.id,
  name: `Pessoa ${i + 1}`, nickname: i === 0 ? 'P1' : null, skill_rating: 3 + i * 0.5, is_goalkeeper: false,
  active: true, preferred_position: i === 0 ? 'attack' : null, created_at: '', updated_at: '' }))
export const config: GameConfig = { name: 'Futebol quinta', matchDate: '2026-09-12', matchTime: '20:00', teamCount: 2, playersOnCourt: 1 }
export const draw = drawTeams({ players: players.map((p) => ({ id: p.id, skillRating: p.skill_rating, isGoalkeeper: p.is_goalkeeper })), playersOnCourt: 1, teamCount: 2, seed: 'fixture-A' })
export const final = { playersOnCourt: 1, teams: draw.teams.map((t) => ({ playerIds: [...t.playerIds], reserveIds: [...t.reserveIds] })) }
export const payload = buildDrawPayload(group.id, config, players, [draw], final)
export const matchId = 'c0000000-0000-0000-0000-000000000001'
export const saved: SavedMatch = {
  match: { id: matchId, group_id: group.id, name: config.name, match_date: config.matchDate, match_time: '20:00:00', team_count: 2,
    players_on_court: 1, status: 'drawn', created_by: 'user', created_at: '2026-09-12T20:00:00Z', updated_at: '' },
  participants: payload.participants.map((p) => ({ ...p, group_id: group.id, match_id: matchId, attendance_status: 'present', created_at: '' })),
  teams: payload.teams.map((t) => ({ ...t, group_id: group.id, match_id: matchId, id: `team-${t.team_index}`, created_at: '' })),
  assignments: payload.assignments.map((a, i) => ({ ...a, id: `assignment-${i}`, team_id: `team-${a.team_index}`, group_id: group.id, match_id: matchId, created_at: '', updated_at: '' })),
  runs: payload.draw_runs.map((r, i) => ({ ...r, id: `run-${i}`, group_id: group.id, match_id: matchId, created_at: '' })),
}
