import type { SavedMatch } from './match-service'

export function formatMatchDate(value: string): string {
  const [year, month, day] = value.split('-')
  return `${day}/${month}/${year}`
}

export function savedResultText(saved: SavedMatch): string {
  const { match, participants, assignments } = saved
  const lines = [match.name || 'Partida de futebol', `${formatMatchDate(match.match_date)}${match.match_time ? ` · ${match.match_time.slice(0, 5)}` : ''}`,
    `${match.team_count} times · ${match.players_on_court} em quadra por time`]
  for (const team of [...saved.teams].sort((a, b) => a.team_index - b.team_index)) {
    lines.push('', `Time ${team.name}`)
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

export async function shareSavedResult(saved: SavedMatch): Promise<'shared' | 'copied' | 'cancelled'> {
  const text = savedResultText(saved)
  if (typeof navigator.share === 'function') {
    try { await navigator.share({ title: saved.match.name || 'Partida de futebol', text }); return 'shared' }
    catch (cause) { if (typeof cause === 'object' && cause !== null && 'name' in cause && cause.name === 'AbortError') return 'cancelled' }
  }
  if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('Compartilhamento indisponível.')
  await navigator.clipboard.writeText(text)
  return 'copied'
}
