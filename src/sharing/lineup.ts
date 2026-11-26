import { formatMatchDate } from '../matches/share-result'
import { isPublicDrawSlug, type Disclosure, type PublicLineup, type PublicPlayer } from './contracts'

export const DRAW_TITLE = 'Times definidos'
export const FUTEBOL_DOMAIN = 'futebol.sabara.org'

export function applyDisclosure(lineup: PublicLineup, options: Disclosure): PublicLineup {
  return {
    ...(options.groupName ? { groupName: lineup.groupName } : {}),
    ...(options.matchDate ? { matchDate: lineup.matchDate } : {}),
    teams: lineup.teams.map(team => ({
      ...team,
      players: team.players.map(({ name, reserve, goalkeeper }) => ({
        name, reserve, ...(options.goalkeepers ? { goalkeeper } : {}),
      })),
    })),
  }
}

export function drawUrl(slug: string, origin = window.location.origin): string {
  if (!isPublicDrawSlug(slug)) throw new Error('Endereço de sorteio inválido.')
  const url = new URL('/s/', origin)
  url.searchParams.set('id', slug)
  return url.href
}

export function lineupDate(lineup: PublicLineup) {
  return lineup.matchDate ? formatMatchDate(lineup.matchDate) : null
}

export function playerLabel(player: PublicPlayer) {
  return player.goalkeeper ? `${player.name} (goleiro)` : player.name
}

export function playerCount(count: number) {
  return count === 1 ? '1 jogador' : `${count} jogadores`
}

export function teamAccent(color: string | null): string {
  if (color === 'blue') return '#2861ba'
  if (color === 'red') return '#b53246'
  if (color === 'green') return '#087358'
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : '#64776f'
}

export function drawMessage(lineup: PublicLineup, link?: string): string {
  const lines = ['⚽ *TIMES DEFINIDOS*']
  const detail = [lineup.groupName, lineupDate(lineup)].filter(Boolean)
  if (detail.length) lines.push('', ...detail as string[])
  for (const team of lineup.teams) {
    const mark = team.color === 'blue' ? '🔵' : team.color === 'red' ? '🔴' : team.color === 'green' ? '🟢' : '⚽'
    lines.push('', `${mark} Time ${team.name} · ${playerCount(team.players.length)}`)
    for (const reserve of [false, true]) {
      const players = team.players.filter(player => player.reserve === reserve)
      if (players.length) lines.push(reserve ? 'Reservas' : 'Titulares', ...players.map(player => `– ${playerLabel(player)}`))
    }
  }
  if (link) lines.push('', 'Confira a escalação completa', link)
  lines.push('', 'Sorteio realizado no Futebol.', 'Organize. Sorteie. Jogue.')
  return lines.join('\n')
}
