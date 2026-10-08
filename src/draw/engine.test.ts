import { drawTeams, DrawInputError, ALGORITHM_VERSION, type DrawInput, type DrawPlayer } from './engine'

function roster(count: number, keepers = 0): DrawPlayer[] {
  return Array.from({ length: count }, (_, i) => ({ id: `p${i}`, skillRating: 1 + (i % 9) * 0.5, isGoalkeeper: i < keepers }))
}
function input(count = 10, teamCount = 2, keepers = 0): DrawInput {
  return { players: roster(count, keepers), teamCount, playersOnCourt: 5, seed: 'repeatable-test' }
}
function invariants(config: DrawInput) {
  const result = drawTeams(config)
  expect(result.teams).toHaveLength(config.teamCount)
  const ids = result.teams.flatMap((team) => team.playerIds)
  expect(ids.slice().sort()).toEqual(config.players.map((p) => p.id).sort())
  expect(new Set(ids).size).toBe(config.players.length)
  const sizes = result.teams.map((team) => team.playerIds.length)
  expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1)
  const keeperCount = config.players.filter((p) => p.isGoalkeeper).length
  expect(result.teams.filter((team) => team.goalkeeperCount > 0)).toHaveLength(Math.min(keeperCount, config.teamCount))
  for (const team of result.teams) {
    expect(team.reserveIds).toHaveLength(Math.max(0, team.playerIds.length - config.playersOnCourt))
    expect(team.reserveIds.every((id) => team.playerIds.includes(id))).toBe(true)
    expect(team.missingPlayers).toBe(Math.max(0, config.playersOnCourt - team.playerIds.length))
    if (team.goalkeeperCount) expect(config.players.some((p) => p.isGoalkeeper && team.playerIds.includes(p.id) && !team.reserveIds.includes(p.id))).toBe(true)
    const sum = config.players.filter((p) => team.playerIds.includes(p.id)).reduce((n, p) => n + p.skillRating, 0)
    expect(team.skillSum).toBe(sum)
    expect(team.skillMean).toBeCloseTo(sum / team.playerIds.length)
  }
  expect(result.balanceScore).toBeCloseTo(Math.max(...result.teams.map((t) => t.skillMean)) - Math.min(...result.teams.map((t) => t.skillMean)))
  return result
}
it.each([
  [10, 2, [5, 5]], [11, 2, [5, 6]], [12, 2, [6, 6]], [13, 2, [6, 7]],
  [14, 3, [4, 5, 5]], [15, 3, [5, 5, 5]], [16, 3, [5, 5, 6]],
  [17, 3, [5, 6, 6]], [18, 3, [6, 6, 6]],
])('distribui %i jogadores em %i times', (count, teamCount, sizes) => {
  const result = invariants(input(count, teamCount))
  expect(result.teams.map((team) => team.playerIds.length).sort()).toEqual(sizes)
})
it.each([2, 3])('aceita o mínimo de um jogador por time: %i', (count) => {
  expect(invariants(input(count, count)).teams.every((t) => t.playerIds.length === 1 && t.missingPlayers === 4)).toBe(true)
})
it.each([0, 1, 2, 3, 5, 18])('distribui %i goleiros sem deixar times desnecessariamente sem goleiro', (keepers) => {
  invariants(input(18, 3, keepers))
})
it('mantém invariantes em 100 seeds, tamanhos, quantidades de goleiros e limites de quadra', () => {
  for (let n = 0; n < 100; n++) {
    const count = 3 + n % 38
    invariants({ ...input(count, n % 2 ? 2 : 3, n % (count + 1)), seed: `run-${n}`, playersOnCourt: n % 20 + 1 })
  }
})
it('reproduz por seed, inclusive após reordenar a entrada, sem mutação', () => {
  const config = input(17, 3, 4)
  const before = structuredClone(config)
  config.players.forEach(Object.freeze)
  Object.freeze(config.players)
  const result = drawTeams(config)
  expect(drawTeams(config)).toEqual(result)
  expect(drawTeams({ ...config, players: [...config.players].reverse() })).toEqual(result)
  expect(config).toEqual(before)
  expect(result.seed).toBe(config.seed)
  expect(result.algorithmVersion).toBe(ALGORITHM_VERSION)
})
it('gera composições diferentes para seeds diferentes com níveis iguais', () => {
  const compositions = new Set<string>()
  for (let i = 0; i < 20; i++) {
    const result = drawTeams({ ...input(), seed: `variety-${i}`, players: roster(10).map((p) => ({ ...p, skillRating: 3 })) })
    expect(result.balanceScore).toBe(0)
    compositions.add(JSON.stringify(result.teams.map((t) => JSON.stringify(t.playerIds.slice().sort())).sort()))
  }
  expect(compositions.size).toBeGreaterThan(10)
})
it('equilibra níveis extremos e usa média quando os tamanhos diferem', () => {
  const players = roster(12).map((p, i) => ({ ...p, skillRating: i < 6 ? 1 : 5 }))
  expect(drawTeams({ ...input(12), players }).balanceScore).toBe(0)
  const result = drawTeams({ ...input(11), players: roster(11).map((p) => ({ ...p, skillRating: 3 })) })
  expect(result.balanceScore).toBe(0)
  expect(result.teams.map((t) => t.skillSum).sort()).toEqual([15, 18])
})
it('não coloca sistematicamente níveis baixos na reserva', () => {
  const reserved = new Set<string>()
  for (let i = 0; i < 60; i++) {
    const result = drawTeams({ ...input(12), seed: `reserves-${i}` })
    result.teams.flatMap((t) => t.reserveIds).forEach((id) => reserved.add(id))
  }
  expect(reserved.size).toBe(12)
})
it.each([0, 1, 4, 2.5, NaN])('rejeita quantidade de times inválida %s', (teamCount) => {
  expect(() => drawTeams({ ...input(), teamCount })).toThrow(DrawInputError)
})
it.each([0, -1, 21, 1.5, NaN, Infinity])('rejeita quantidade em quadra inválida %s', (playersOnCourt) => {
  expect(() => drawTeams({ ...input(), playersOnCourt })).toThrow(DrawInputError)
})
it.each([0, 1, 2])('rejeita %i jogadores para três times', (n) => {
  expect(() => drawTeams(input(n, 3))).toThrow('Selecione pelo menos um jogador por time.')
})
it.each([0, 5.5, 3.2, NaN, Infinity])('rejeita nível inválido %s', (skillRating) => {
  expect(() => drawTeams({ ...input(), players: [{ ...roster(1)[0]!, skillRating }, ...roster(10).slice(1)] })).toThrow(DrawInputError)
})
it('rejeita IDs vazios/duplicados, seed vazia e dados malformados em runtime', () => {
  for (const config of [
    null, {}, { ...input(), players: null }, { ...input(), seed: ' ' },
    { ...input(), players: [null, ...roster(10)] },
    { ...input(), players: [{ ...roster(1)[0]!, id: '' }, ...roster(10).slice(1)] },
    { ...input(), players: [...roster(10), roster(1)[0]] },
    { ...input(), players: [{ ...roster(1)[0]!, isGoalkeeper: 'yes' }, ...roster(10).slice(1)] },
  ]) expect(() => drawTeams(config as DrawInput)).toThrow(DrawInputError)
})
