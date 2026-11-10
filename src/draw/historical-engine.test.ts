import { brokenRule, type DrawRule } from './draw-rules'
import { validateAdjustment } from './adjustments'
import { historicalWeights, repeatedPairs, type HistoricalSnapshot } from './historical-engine'
import { drawByMode, meanGap, modeForVersion } from './smart-engine'
import type { DrawResult } from './engine'

function roster(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: String(i), skillRating: 2 + (i % 6) / 2, isGoalkeeper: i < 3,
  }))
}

function starterGap(result: DrawResult, players: ReadonlyMap<string, { skillRating: number }>) {
  return meanGap(result.teams.map(team => {
    const starting = team.playerIds.filter(id => !team.reserveIds.includes(id))
    return starting.reduce((sum, id) => sum + players.get(id)!.skillRating, 0) / starting.length
  }))
}

it('keeps previous paths for Clássico, empty history and wholly new pairs', () => {
  const input = { players: roster(12), playersOnCourt: 4, teamCount: 2, seed: 'unchanged' }
  const history = [drawByMode(input, 'balanced').teams]
  expect(drawByMode(input, 'classic', [], undefined, history)).toEqual(drawByMode(input, 'classic'))
  expect(drawByMode(input, 'balanced', [], undefined, [])).toEqual(drawByMode(input, 'balanced'))
  expect(drawByMode(input, 'competitive', [], undefined, [[{ playerIds: ['0', 'new'], reserveIds: [] }]])).toEqual(drawByMode(input, 'competitive'))
})

it('weights recent teammates and gives extra weight to previous starter pairs', () => {
  const weights = historicalWeights([
    [{ playerIds: ['b', 'a', 'c', 'new'], reserveIds: ['c'] }],
    [{ playerIds: ['a', 'b'], reserveIds: ['b'] }],
  ], new Set(['a', 'b', 'c']))
  expect(weights.get('a')?.get('b')).toEqual({ roster: 3, starters: 2 })
  expect(weights.get('a')?.get('c')).toEqual({ roster: 2, starters: 0 })
  expect(weights.get('a')?.has('new')).toBe(false)
})

it('benchmarks bounded diversity against identical seeds and checks the lineup invariants', () => {
  const rows = []
  const rules: DrawRule[] = [
    { kind: 'fixed', player: '0', team: 0 },
    { kind: 'together', player: '3', other: '4' },
    { kind: 'apart', player: '3', other: '5' },
  ]
  for (const mode of ['balanced', 'competitive'] as const) {
    for (const scenario of [
      { count: 14, teamCount: 2, playersOnCourt: 5, matches: 1, changed: 0, rules: [] },
      { count: 21, teamCount: 3, playersOnCourt: 5, matches: 7, changed: 3, rules: [] },
      { count: 21, teamCount: 3, playersOnCourt: 5, matches: 7, changed: 3, rules },
      { count: 120, teamCount: 3, playersOnCourt: 20, matches: 10, changed: 0, rules },
    ]) {
      const old = roster(scenario.count)
      const players = old.map((player, i) => i >= old.length - scenario.changed ? { ...player, id: 'new-' + i } : player)
      const input = { players, teamCount: scenario.teamCount, playersOnCourt: scenario.playersOnCourt }
      const reference = drawByMode({ ...input, players: old, seed: 'old' }, mode, scenario.rules)
      // Alternate the order of teams while keeping many of the same pairs across weeks.
      const snapshot: HistoricalSnapshot = Array.from({ length: scenario.matches }, (_, i) => i % 2 ? [...reference.teams].reverse() : reference.teams)
      const weights = historicalWeights(snapshot, new Set(players.map(player => player.id)))
      const byId = new Map(players.map(player => [player.id, player]))
      const totals = { base: [0, 0, 0, 0, 0, 0], history: [0, 0, 0, 0, 0, 0] }
      const distinct = { base: new Set<string>(), history: new Set<string>() }
      for (let i = 0; i < 24; i++) {
        const seeded = { ...input, seed: 'sample-' + i }
        const before = performance.now()
        const base = drawByMode(seeded, mode, scenario.rules)
        const middle = performance.now()
        const history = drawByMode(seeded, mode, scenario.rules, undefined, snapshot)
        const end = performance.now()
        const name = (result: DrawResult) => JSON.stringify(result.teams.map(team => [...team.playerIds].sort().join(',')).sort())
        for (const [key, result, ms] of [['base', base, middle - before], ['history', history, end - middle]] as const) {
          const pairs = repeatedPairs(result.teams, weights)
          const keeperGap = meanGap(result.teams.map(team => team.goalkeeperCount))
          const metrics = [pairs.roster, pairs.starters, result.balanceScore, starterGap(result, byId), keeperGap, ms]
          metrics.forEach((value, index) => { totals[key][index]! += value })
          distinct[key].add(name(result))
        }
        expect(validateAdjustment({ playersOnCourt: input.playersOnCourt, teams: history.teams }, byId)).toBeNull()
        expect(brokenRule(scenario.rules, history.teams)).toBeUndefined()
        expect(history.teams.map(team => team.goalkeeperCount)).toEqual(base.teams.map(team => team.goalkeeperCount))
        expect(history.balanceScore).toBeLessThanOrEqual(base.balanceScore + 0.125001)
        expect(starterGap(history, byId)).toBeLessThanOrEqual(starterGap(base, byId) + (mode === 'balanced' ? 0.100001 : 0.050001))
        if (i === 0) {
          expect(modeForVersion(history.algorithmVersion)).toBe(mode)
          expect(drawByMode({ ...seeded, players: [...players].reverse() }, mode, scenario.rules, undefined, snapshot)).toEqual(history)
        }
      }
      expect(totals.history[0]).toBeLessThan(totals.base[0]!)
      expect(distinct.history.size).toBeGreaterThan(1)
      rows.push({
        mode, players: players.length, rules: scenario.rules.length,
        base: totals.base.map(value => Number((value / 24).toFixed(3))),
        history: totals.history.map(value => Number((value / 24).toFixed(3))),
        distinct: [distinct.base.size, distinct.history.size],
      })
    }
  }
  if (process.env.FUTEBOL_HISTORY_BENCHMARK) console.info(JSON.stringify(rows))
})
