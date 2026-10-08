import type { Player } from '../groups/group-service'
import type { DrawResult } from '../draw/engine'
import type { AdjustmentState } from '../draw/adjustments'

export type GameConfig = { name: string; matchDate: string; matchTime: string; playersOnCourt: number; teamCount: number }
export const TEAM_NAMES = ['Azul', 'Vermelho', 'Verde']
const TEAM_COLORS = ['blue', 'red', 'green']

/** Only fields accepted by save_match_draw; identity/status always belong to the RPC. */
export function buildDrawPayload(groupId: string, config: GameConfig, players: Player[], runs: DrawResult[], final: AdjustmentState) {
  const base = runs.at(-1)
  if (!base) throw new Error('Sorteio ausente.')
  const byId = new Map(players.map((p) => [p.id, p]))
  return {
    group_id: groupId, name: config.name.trim() || null, match_date: config.matchDate,
    match_time: config.matchTime || null, team_count: config.teamCount, players_on_court: config.playersOnCourt,
    participants: final.teams.flatMap((team) => team.playerIds).sort().map((id) => {
      const p = byId.get(id)
      if (!p) throw new Error('Participante indisponível.')
      return { player_id: id, player_name_snapshot: p.name, player_nickname_snapshot: p.nickname,
        skill_rating_snapshot: Number(p.skill_rating), is_goalkeeper_snapshot: p.is_goalkeeper,
        preferred_position_snapshot: p.preferred_position }
    }),
    teams: final.teams.map((_, index) => ({ team_index: index + 1, name: TEAM_NAMES[index]!, color: TEAM_COLORS[index]! })),
    assignments: final.teams.flatMap((team, index) => team.playerIds.map((id) => {
      const reserve = team.reserveIds.includes(id)
      const unchanged = base.teams[index]?.playerIds.includes(id) && base.teams[index]?.reserveIds.includes(id) === reserve
      return { player_id: id, team_index: index + 1, starts_as_reserve: reserve,
        assignment_source: unchanged ? 'draw' as const : 'manual' as const }
    })),
    draw_runs: runs.map((run, index) => ({ run_number: index + 1, seed: run.seed,
      algorithm_version: run.algorithmVersion, balance_score: run.balanceScore, accepted: index === runs.length - 1 })),
  }
}
export type SaveDrawPayload = ReturnType<typeof buildDrawPayload>
