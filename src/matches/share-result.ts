import type { GameConfig } from './draw-payload'
import type { Player } from '../groups/group-service'
import type { SavedMatch } from './match-service'

export function formatMatchDate(value: string): string {
  const [year, month, day] = value.split('-')
  return `${day}/${month}/${year}`
}

export function savedResultText(saved: SavedMatch): string {
  const { match, participants, assignments } = saved
  const lines = [`⚽ ${match.name || 'Partida de futebol'}`, `${formatMatchDate(match.match_date)}${match.match_time ? ` · ${match.match_time.slice(0, 5)}` : ''}`,
    `${match.team_count} times · ${match.players_on_court} em quadra por time`]
  for (const team of [...saved.teams].sort((a, b) => a.team_index - b.team_index)) {
    lines.push('', `${['🔵', '🔴', '🟡'][team.team_index - 1] ?? '⚽'} Time ${team.name}`)
    for (const [reserve, label] of [[false, 'Titulares'], [true, 'Reservas']] as const) {
      lines.push(`${label}:`)
      const rows = assignments.filter((a) => a.team_id === team.id && a.starts_as_reserve === reserve)
      if (!rows.length) lines.push('— Nenhum')
      for (const row of rows) {
        const p = participants.find((p) => p.player_id === row.player_id)!
        lines.push(`— ${p.player_nickname_snapshot || p.player_name_snapshot}${p.is_goalkeeper_snapshot ? ' (goleiro)' : ''}`)
      }
    }
  }
  return lines.join('\n')
}

export function whatsAppResultUrl(saved: SavedMatch): string {
  return `https://wa.me/?text=${encodeURIComponent(savedResultText(saved))}`
}

export function participantListText(config: GameConfig, players: Player[]): string {
  return [
    config.name.trim() || 'Partida de futebol',
    formatMatchDate(config.matchDate) + (config.matchTime ? ` · ${config.matchTime}` : ''),
    `${config.teamCount} times · ${config.playersOnCourt} em quadra por time`,
    '',
    `Participantes confirmados (${players.length})`,
    ...players.map((player, index) => `${index + 1} - ${player.nickname || player.name}`),
  ].join('\n')
}

export async function copyMatchText(text: string): Promise<void> {
  if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('Cópia indisponível.')
  await navigator.clipboard.writeText(text)
}

export async function shareMatchText(title: string, text: string): Promise<'shared' | 'copied' | 'cancelled'> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text })
      return 'shared'
    } catch (cause) {
      if (typeof cause === 'object' && cause !== null && 'name' in cause && cause.name === 'AbortError') return 'cancelled'
    }
  }
  await copyMatchText(text)
  return 'copied'
}

export function shareSavedResult(saved: SavedMatch) {
  return shareMatchText(saved.match.name || 'Partida de futebol', savedResultText(saved))
}

export function copySavedResult(saved: SavedMatch) {
  return copyMatchText(savedResultText(saved))
}
