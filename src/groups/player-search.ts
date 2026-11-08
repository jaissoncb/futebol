import type { Player } from './group-service'

export function searchPlayers(players: Player[], query: string): Player[] {
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR')
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean)
  return players.filter(player => terms.every(term => normalize(`${player.name} ${player.nickname ?? ''}`).includes(term)))
}
