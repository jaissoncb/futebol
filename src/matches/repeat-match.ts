import type { Player } from '../groups/group-service'
import type { GameConfig } from './draw-payload'
import type { SavedMatch } from './match-service'
import { localDateInputValue } from '../draw/local-date'

export interface RepeatDraft { config: GameConfig; selectedIds: string[]; unavailable: number }

/** Only prepare a new draft. Current roster wins; never reuse a match ID or draw. */
export function repeatMatch(saved: SavedMatch, groupId: string, players: Player[]): RepeatDraft {
  if (saved.match.group_id !== groupId) throw new Error('Partida de outro grupo.')
  const eligible = new Set(players.filter(p => p.group_id === groupId && p.active).map(p => p.id))
  const ids = [...new Set(saved.participants.map(p => p.player_id))]
  const selectedIds = ids.filter(id => eligible.has(id))
  return { config: { name: saved.match.name ?? '', matchDate: localDateInputValue(),
    matchTime: saved.match.match_time?.slice(0, 5) ?? '', teamCount: saved.match.team_count,
    playersOnCourt: saved.match.players_on_court }, selectedIds, unavailable: ids.length - selectedIds.length }
}
