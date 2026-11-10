import { validateAdjustment } from './adjustments'
import { drawTeams, type DrawResult } from './engine'
import { DRAW_MODES, drawByMode, meanGap, type DrawMode } from './smart-engine'

const modes = ['classic', 'balanced', 'competitive'] as const
const positions = ['attack', 'defense', 'midfield'] as const
const fixtures = [
  { count: 12, teamCount: 2, playersOnCourt: 5, keepers: 2 },
  { count: 19, teamCount: 3, playersOnCourt: 5, keepers: 4 },
  { count: 16, teamCount: 3, playersOnCourt: 6, keepers: 1 },
  { count: 34, teamCount: 3, playersOnCourt: 8, keepers: 10 },
  { count: 15, teamCount: 2, playersOnCourt: 5, keepers: 0 },
]

function roster(count: number, keepers: number, skew = false) {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index}`,
    skillRating: skew ? (index % 4 === 0 ? 5 : 1) : 1 + ((index * 5 + Math.floor(index / 4)) % 9) / 2,
    isGoalkeeper: index < keepers,
    preferredPosition: index < keepers ? 'goalkeeper' as const : index % 7 === 0 ? null : positions[index % positions.length]!,
  }))
}

function gaps(result: DrawResult, players: ReturnType<typeof roster>) {
  const byId = new Map(players.map(player => [player.id, player]))
  const starters = result.teams.map(team => team.playerIds.filter(id => !team.reserveIds.includes(id)))
  const starterMeans = starters.map(ids => ids.reduce((sum, id) => sum + byId.get(id)!.skillRating, 0) / ids.length)
  const positionGap = positions.reduce((sum, position) => sum + meanGap(starters.map(ids =>
    ids.filter(id => byId.get(id)!.preferredPosition === position).length)), 0) / positions.length
  return { roster: meanGap(result.teams.map(team => team.skillMean)), starters: meanGap(starterMeans), positions: positionGap }
}

it('compara 100 pares de elenco e seed sem mudar o Clássico nem o significado de balance_score', () => {
  const totals = Object.fromEntries(modes.map(mode => [mode, { roster: 0, starters: 0, positions: 0 }])) as Record<DrawMode, ReturnType<typeof gaps>>
  for (const fixture of fixtures) {
    for (let i = 0; i < 20; i++) {
      const players = roster(fixture.count, fixture.keepers, i % 2 === 0)
      const input = { ...fixture, players, seed: `comparacao-${i}` }
      const byId = new Map(players.map(player => [player.id, player]))
      expect(drawByMode(input)).toEqual(drawTeams(input))
      for (const mode of modes) {
        const result = drawByMode(input, mode)
        const metrics = gaps(result, players)
        expect(result.algorithmVersion).toBe(DRAW_MODES[mode].version)
        expect(result.balanceScore).toBeCloseTo(metrics.roster, 12)
        expect(validateAdjustment({ teams: result.teams, playersOnCourt: input.playersOnCourt }, byId)).toBeNull()
        expect(result.teams.flatMap(team => team.playerIds).sort()).toEqual(players.map(player => player.id).sort())
        if (mode !== 'classic') expect(meanGap(result.teams.map(team => team.goalkeeperCount))).toBeLessThanOrEqual(1)
        for (const metric of ['roster', 'starters', 'positions'] as const) totals[mode][metric] += metrics[metric] / 100
      }
    }
  }
  console.table(totals)
  expect(totals.balanced.positions).toBeLessThan(totals.classic.positions)
  expect(totals.balanced.starters).toBeLessThan(totals.classic.starters)
  expect(totals.competitive.starters).toBeLessThan(totals.balanced.starters)
  expect(totals.competitive.roster).toBeLessThan(totals.classic.roster + 0.15)
})

it.each(['balanced', 'competitive'] as const)('%s reproduz a escalação, varia times e sorteia reservas independentemente de nível', mode => {
  const players = roster(20, 3)
  const input = { players, teamCount: 3, playersOnCourt: 4, seed: 'repeticao' }
  const first = drawByMode(input, mode)
  expect(drawByMode({ ...input, players: [...players].reverse() }, mode)).toEqual(first)
  const lineups = new Set<string>()
  const reserveSets = new Set<string>()
  for (let i = 0; i < 20; i++) {
    const seeded = { ...input, seed: `variacao-${i}` }
    const draw = drawByMode(seeded, mode)
    const reserves = draw.teams.flatMap(team => team.reserveIds).sort()
    const differentRatings = players.map(player => ({ ...player, skillRating: 6 - player.skillRating }))
    expect(drawByMode({ ...seeded, players: differentRatings }, mode).teams.flatMap(team => team.reserveIds).sort()).toEqual(reserves)
    reserveSets.add(JSON.stringify(reserves))
    lineups.add(JSON.stringify(draw.teams.map(team => [...team.playerIds].sort().join(',')).sort()))
  }
  expect(lineups.size).toBeGreaterThan(15)
  expect(reserveSets.size).toBeGreaterThan(15)
})

it('lida com preferências ausentes, jogo mínimo e cargas grandes', () => {
  const start = performance.now()
  for (const mode of modes) {
    const tiny = roster(3, 3).map(player => ({ ...player, preferredPosition: null }))
    const result = drawByMode({ players: tiny, teamCount: 3, playersOnCourt: 1, seed: 'minimo' }, mode)
    expect(result.teams.map(team => team.goalkeeperCount)).toEqual([1, 1, 1])
    const large = roster(90, 14)
    for (let i = 0; i < 10; i++) {
      const result = drawByMode({ players: large, teamCount: 3, playersOnCourt: 20, seed: `carga-${i}` }, mode)
      expect(result.teams.map(team => team.reserveIds.length)).toEqual([10, 10, 10])
    }
  }
  console.info(`30 sorteios de 90 jogadores e 3 mínimos em ${Math.round(performance.now() - start)} ms`)
}, 10_000)
