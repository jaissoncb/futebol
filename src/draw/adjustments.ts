import type { DrawPlayer } from './engine'

export interface EditableTeam {
  playerIds: string[]
  reserveIds: string[]
}

export interface AdjustmentState {
  teams: EditableTeam[]
  playersOnCourt: number
}

export type AdjustmentResult = { ok: true; state: AdjustmentState } | { ok: false; message: string }

function clone(state: AdjustmentState): AdjustmentState {
  return { ...state, teams: state.teams.map((team) => ({ playerIds: [...team.playerIds], reserveIds: [...team.reserveIds] })) }
}

function onCourtIds(team: EditableTeam) { return team.playerIds.filter((id) => !team.reserveIds.includes(id)) }

function hasKeeperOnCourt(team: EditableTeam, players: ReadonlyMap<string, DrawPlayer>) {
  return onCourtIds(team).some((id) => players.get(id)?.isGoalkeeper)
}

function promoteReserveIfNeeded(team: EditableTeam, playersOnCourt: number, players: ReadonlyMap<string, DrawPlayer>) {
  const expectedOnCourt = Math.min(playersOnCourt, team.playerIds.length)
  while (onCourtIds(team).length < expectedOnCourt) {
    const keeperReserve = team.reserveIds.find((id) => players.get(id)?.isGoalkeeper)
    const next = !hasKeeperOnCourt(team, players) && keeperReserve ? keeperReserve : team.reserveIds[0]
    if (!next) return
    team.reserveIds = team.reserveIds.filter((id) => id !== next)
  }
}

/** Rejects invalid manual states rather than weakening the Phase 4 goalkeeper guarantee. */
export function validateAdjustment(state: AdjustmentState, players: ReadonlyMap<string, DrawPlayer>): string | null {
  const all = state.teams.flatMap((team) => team.playerIds)
  if (new Set(all).size !== all.length) return 'Um jogador não pode estar em mais de um time.'
  const sizes = state.teams.map((team) => team.playerIds.length)
  if (Math.max(...sizes) - Math.min(...sizes) > 1) return 'O ajuste deixaria os times com tamanhos inválidos.'
  for (const team of state.teams) {
    if (team.reserveIds.some((id) => !team.playerIds.includes(id))) return 'A reserva precisa pertencer ao próprio time.'
    const expectedOnCourt = Math.min(state.playersOnCourt, team.playerIds.length)
    if (onCourtIds(team).length !== expectedOnCourt) return 'A quantidade de jogadores em quadra precisa ser mantida.'
    if (team.playerIds.some((id) => players.get(id)?.isGoalkeeper) && expectedOnCourt > 0 && !hasKeeperOnCourt(team, players)) {
      return 'Este time possui goleiro, então um goleiro precisa permanecer em quadra.'
    }
  }
  const keeperCount = all.filter((id) => players.get(id)?.isGoalkeeper).length
  const coveredTeams = state.teams.filter((team) => hasKeeperOnCourt(team, players)).length
  if (coveredTeams < Math.min(keeperCount, state.teams.length)) {
    return 'O ajuste concentraria goleiros e reduziria a cobertura dos times.'
  }
  return null
}

export function swapPlayers(state: AdjustmentState, firstTeamIndex: number, firstId: string, secondTeamIndex: number, secondId: string, players: ReadonlyMap<string, DrawPlayer>): AdjustmentResult {
  if (firstTeamIndex === secondTeamIndex) return { ok: false, message: 'Escolha um jogador de outro time para trocar.' }
  const next = clone(state)
  const first = next.teams[firstTeamIndex]
  const second = next.teams[secondTeamIndex]
  if (!first || !second || !first.playerIds.includes(firstId) || !second.playerIds.includes(secondId)) return { ok: false, message: 'Jogador não disponível para este ajuste.' }
  const firstWasReserve = first.reserveIds.includes(firstId)
  const secondWasReserve = second.reserveIds.includes(secondId)
  first.playerIds[first.playerIds.indexOf(firstId)] = secondId
  second.playerIds[second.playerIds.indexOf(secondId)] = firstId
  // The incoming player occupies exactly the outgoing player's starter/reserve slot.
  if (firstWasReserve) first.reserveIds[first.reserveIds.indexOf(firstId)] = secondId
  if (secondWasReserve) second.reserveIds[second.reserveIds.indexOf(secondId)] = firstId
  const issue = validateAdjustment(next, players)
  return issue ? { ok: false, message: issue } : { ok: true, state: next }
}

export function movePlayer(state: AdjustmentState, fromIndex: number, playerId: string, toIndex: number, players: ReadonlyMap<string, DrawPlayer>): AdjustmentResult {
  const next = clone(state)
  const from = next.teams[fromIndex]
  const to = next.teams[toIndex]
  if (!from || !to || fromIndex === toIndex || !from.playerIds.includes(playerId)) return { ok: false, message: 'Jogador não disponível para este ajuste.' }
  from.playerIds = from.playerIds.filter((id) => id !== playerId)
  from.reserveIds = from.reserveIds.filter((id) => id !== playerId)
  promoteReserveIfNeeded(from, next.playersOnCourt, players)
  to.playerIds.push(playerId)
  // The player is initially a reserve only when the destination already has all court positions filled.
  if (onCourtIds(to).length >= Math.min(next.playersOnCourt, to.playerIds.length)) to.reserveIds.push(playerId)
  const issue = validateAdjustment(next, players)
  return issue ? { ok: false, message: issue } : { ok: true, state: next }
}

export function swapCourtStatus(state: AdjustmentState, teamIndex: number, firstId: string, secondId: string, players: ReadonlyMap<string, DrawPlayer>): AdjustmentResult {
  const next = clone(state)
  const team = next.teams[teamIndex]
  if (!team || !team.playerIds.includes(firstId) || !team.playerIds.includes(secondId)) return { ok: false, message: 'Jogador não disponível para este ajuste.' }
  const firstReserve = team.reserveIds.includes(firstId)
  const secondReserve = team.reserveIds.includes(secondId)
  if (firstReserve === secondReserve) return { ok: false, message: 'Escolha um titular e uma reserva para alternar.' }
  team.reserveIds = team.reserveIds.filter((id) => id !== firstId && id !== secondId)
  team.reserveIds.push(firstReserve ? secondId : firstId)
  const issue = validateAdjustment(next, players)
  return issue ? { ok: false, message: issue } : { ok: true, state: next }
}
