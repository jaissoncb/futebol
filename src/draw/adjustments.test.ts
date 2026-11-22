import { describe, expect, it } from 'vitest'
import { drawTeams, type DrawPlayer } from './engine'
import { movePlayer, swapCourtStatus, swapPlayers, validateAdjustment, type AdjustmentState } from './adjustments'

const players = new Map<string, DrawPlayer>([
  ['g1', { id: 'g1', skillRating: 3, isGoalkeeper: true }],
  ['g2', { id: 'g2', skillRating: 3, isGoalkeeper: true }],
  ['a', { id: 'a', skillRating: 2, isGoalkeeper: false }],
  ['b', { id: 'b', skillRating: 3, isGoalkeeper: false }],
  ['c', { id: 'c', skillRating: 4, isGoalkeeper: false }],
  ['d', { id: 'd', skillRating: 5, isGoalkeeper: false }],
])
const state: AdjustmentState = { playersOnCourt: 2, teams: [
  { playerIds: ['g1', 'a', 'b'], reserveIds: ['b'] },
  { playerIds: ['g2', 'c', 'd'], reserveIds: ['d'] },
] }

describe('ajustes locais da Fase 6', () => {
  it('preserva os slots em trocas titular ↔ titular', () => {
    const result = swapPlayers(state, 0, 'a', 1, 'c', players)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.teams.flatMap((team) => team.playerIds).sort()).toEqual(['a', 'b', 'c', 'd', 'g1', 'g2'])
    expect(result.state.teams.map((team) => team.playerIds)).toEqual([['g1', 'c', 'b'], ['g2', 'a', 'd']])
    expect(result.state.teams.map((team) => team.reserveIds)).toEqual([['b'], ['d']])
  })

  it('preserva os slots em trocas reserva ↔ reserva', () => {
    const result = swapPlayers(state, 0, 'b', 1, 'd', players)
    expect(result).toEqual({ ok: true, state: { playersOnCourt: 2, teams: [
      { playerIds: ['g1', 'a', 'd'], reserveIds: ['d'] },
      { playerIds: ['g2', 'c', 'b'], reserveIds: ['b'] },
    ] } })
  })

  it('preserva os slots em trocas titular ↔ reserva', () => {
    const result = swapPlayers(state, 0, 'a', 1, 'd', players)
    expect(result).toEqual({ ok: true, state: { playersOnCourt: 2, teams: [
      { playerIds: ['g1', 'd', 'b'], reserveIds: ['b'] },
      { playerIds: ['g2', 'c', 'a'], reserveIds: ['a'] },
    ] } })
  })

  it('preserva os slots em trocas reserva ↔ titular', () => {
    const result = swapPlayers(state, 0, 'b', 1, 'c', players)
    expect(result).toEqual({ ok: true, state: { playersOnCourt: 2, teams: [
      { playerIds: ['g1', 'a', 'c'], reserveIds: ['c'] },
      { playerIds: ['g2', 'b', 'd'], reserveIds: ['d'] },
    ] } })
  })

  it('move entre dois times desiguais, promove a reserva e permite movimentos consecutivos e inversos', () => {
    const moved = movePlayer(state, 0, 'a', 1, players)
    if (!moved.ok) throw new Error(moved.message)
    expect(moved.state.teams).toEqual([
      { playerIds: ['g1', 'b'], reserveIds: [] },
      { playerIds: ['g2', 'c', 'd', 'a'], reserveIds: ['d', 'a'] },
    ])
    const next = movePlayer(moved.state, 1, 'd', 0, players)
    if (!next.ok) throw new Error(next.message)
    const reversed = movePlayer(next.state, 1, 'a', 0, players)
    if (!reversed.ok) throw new Error(reversed.message)
    expect(reversed.state.teams).toEqual([
      { playerIds: ['g1', 'b', 'd', 'a'], reserveIds: ['d', 'a'] },
      { playerIds: ['g2', 'c'], reserveIds: [] },
    ])
    expect(swapPlayers(reversed.state, 0, 'b', 1, 'c', players).ok).toBe(true)
    expect(swapCourtStatus(reversed.state, 0, 'b', 'a', players).ok).toBe(true)
  })

  it('rejeita mover o último jogador de um time', () => {
    const twoTeams: AdjustmentState = { playersOnCourt: 2, teams: [
      { playerIds: ['a'], reserveIds: [] }, { playerIds: ['b', 'c'], reserveIds: [] },
    ] }
    expect(movePlayer(twoTeams, 0, 'a', 1, players)).toEqual({ ok: false, message: 'O ajuste deixaria um time vazio.' })
  })

  it.each([
    [9, 3, 3, [3, 3, 3], [4, 3, 2]],
    [10, 3, 3, [4, 3, 3], [4, 4, 2]],
    [11, 3, 4, [4, 4, 3], [5, 4, 2]],
    [12, 4, 4, [4, 4, 4], [5, 4, 3]],
    [13, 4, 4, [5, 4, 4], [5, 5, 3]],
    [14, 4, 5, [5, 5, 4], [6, 5, 3]],
    [15, 5, 5, [5, 5, 5], [6, 5, 4]],
  ])('ajusta um sorteio automático de %i jogadores e preserva elenco, goleiros e reservas', (count, fromSize, toSize, initial, expected) => {
    const roster = Array.from({ length: count }, (_, index) => ({
      id: String(index + 1), skillRating: 1 + index % 9 / 2, isGoalkeeper: index < 3,
    }))
    const byId = new Map(roster.map(player => [player.id, player]))
    const sizeOrder = (teams: AdjustmentState['teams']) => teams.map(team => team.playerIds.length).sort((a, b) => b - a)
    const { teams } = drawTeams({ players: roster, teamCount: 3, playersOnCourt: 5, seed: `manual-${count}` })
    expect(sizeOrder(teams)).toEqual(initial)
    const from = teams.findIndex(team => team.playerIds.length === fromSize)
    const to = teams.findIndex((team, index) => index !== from && team.playerIds.length === toSize)
    const moving = teams[from]!.playerIds.find(id => !byId.get(id)!.isGoalkeeper)!
    const result = movePlayer({ teams, playersOnCourt: 5 }, from, moving, to, byId)
    if (!result.ok) throw new Error(result.message)
    expect(sizeOrder(result.state.teams)).toEqual(expected)
    expect(result.state.teams.flatMap(team => team.playerIds).sort()).toEqual(roster.map(player => player.id).sort())
    for (const team of result.state.teams) {
      expect(team.reserveIds).toHaveLength(Math.max(0, team.playerIds.length - 5))
      expect(team.playerIds.filter(id => byId.get(id)!.isGoalkeeper && !team.reserveIds.includes(id))).toHaveLength(1)
    }
  })

  it('troca titular e reserva no próprio time, mantendo a quantidade em quadra', () => {
    const result = swapCourtStatus(state, 0, 'a', 'b', players)
    expect(result).toEqual({ ok: true, state: { playersOnCourt: 2, teams: [{ playerIds: ['g1', 'a', 'b'], reserveIds: ['a'] }, state.teams[1]] } })
  })

  it('não deixa um time com goleiro sem goleiro em quadra quando há alternativa', () => {
    expect(swapCourtStatus(state, 0, 'g1', 'b', players)).toEqual({ ok: false, message: 'Este time possui goleiro, então um goleiro precisa permanecer em quadra.' })
  })

  it('mantém cobertura de todos os times quando há goleiros suficientes', () => {
    const covered: AdjustmentState = { playersOnCourt: 2, teams: [
      { playerIds: ['g1', 'a'], reserveIds: [] },
      { playerIds: ['g2', 'b'], reserveIds: [] },
      { playerIds: ['g3', 'c'], reserveIds: [] },
    ] }
    const withThreeKeepers = new Map([...players, ['g3', { id: 'g3', skillRating: 3, isGoalkeeper: true }] as const])
    expect(swapPlayers(covered, 0, 'g1', 1, 'b', withThreeKeepers)).toEqual({ ok: false, message: 'O ajuste concentraria goleiros e reduziria a cobertura dos times.' })
    expect(swapPlayers(covered, 0, 'g1', 1, 'g2', withThreeKeepers).ok).toBe(true)
  })

  it('não reduz a cobertura possível quando há menos goleiros que times', () => {
    const limited: AdjustmentState = { playersOnCourt: 2, teams: [
      { playerIds: ['g1', 'a'], reserveIds: [] },
      { playerIds: ['g2', 'b'], reserveIds: [] },
      { playerIds: ['c', 'd'], reserveIds: [] },
    ] }
    expect(swapPlayers(limited, 0, 'g1', 1, 'b', players)).toEqual({ ok: false, message: 'O ajuste concentraria goleiros e reduziria a cobertura dos times.' })
    expect(swapPlayers(limited, 0, 'g1', 1, 'g2', players).ok).toBe(true)
  })

  it('rejeita mover o único goleiro para um time que já possui goleiro', () => {
    const movable: AdjustmentState = { playersOnCourt: 1, teams: [
      { playerIds: ['g1', 'a'], reserveIds: ['a'] },
      { playerIds: ['g2'], reserveIds: [] },
    ] }
    expect(movePlayer(movable, 0, 'g1', 1, players)).toEqual({ ok: false, message: 'O ajuste concentraria goleiros e reduziria a cobertura dos times.' })
  })

  it('detecta reserva externa, duplicidade e contagem de quadra inválidas', () => {
    expect(validateAdjustment({ playersOnCourt: 2, teams: [{ playerIds: ['g1', 'a'], reserveIds: ['g2'] }, { playerIds: ['g2', 'b'], reserveIds: [] }] }, players)).toBe('A reserva precisa pertencer ao próprio time.')
    expect(validateAdjustment({ playersOnCourt: 2, teams: [{ playerIds: ['g1', 'a'], reserveIds: [] }, { playerIds: ['g1', 'b'], reserveIds: [] }] }, players)).toBe('Um jogador não pode estar em mais de um time.')
  })
})
