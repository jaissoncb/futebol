import { DrawInputError, type DrawInput } from './engine'
import { brokenRule, type DrawRule } from './draw-rules'
import { drawByMode, modeForVersion, type DrawMode } from './smart-engine'

const modes = ['classic', 'balanced', 'competitive'] as const
const together: DrawRule = { kind: 'together', player: 'p0', other: 'p1' }
const apart: DrawRule = { kind: 'apart', player: 'p1', other: 'p2' }
const fixed: DrawRule = { kind: 'fixed', player: 'p2', team: 1 }

function input(size: number, teamCount: number, keeperCount = 0): DrawInput {
  return {
    players: Array.from({ length: size }, (_, i) => ({
      id: 'p' + i, skillRating: 1 + i % 9 / 2, isGoalkeeper: i < keeperCount,
    })),
    teamCount, playersOnCourt: 2, seed: 'fase-6b',
  }
}

function feasible({ players, teamCount }: DrawInput, rules: DrawRule[], mode: DrawMode) {
  for (let assignment = 0; assignment < teamCount ** players.length; assignment++) {
    const teams = Array.from({ length: teamCount }, () => ({ playerIds: [] as string[], keepers: 0 }))
    let code = assignment
    for (const player of players) {
      const team = teams[code % teamCount]!
      team.playerIds.push(player.id)
      team.keepers += Number(player.isGoalkeeper)
      code = Math.floor(code / teamCount)
    }
    const sizes = teams.map(team => team.playerIds.length)
    const keepers = teams.map(team => team.keepers)
    if (Math.max(...sizes) - Math.min(...sizes) > 1) continue
    if (keepers.filter(Boolean).length < Math.min(teamCount, players.filter(player => player.isGoalkeeper).length)) continue
    if (mode !== 'classic' && Math.max(...keepers) - Math.min(...keepers) > 1) continue
    if (!brokenRule(rules, teams)) return true
  }
  return false
}

it.each(modes)('combina regras em %s, mantém goleiros em quadra e reproduz a escalação', mode => {
  const base = input(11, 3, 4)
  // Um goleiro fica livre para cada time restante.
  const rules: DrawRule[] = [
    together, { kind: 'together', player: 'p1', other: 'p4' }, apart, fixed,
    { kind: 'fixed', player: 'p3', team: 2 },
  ]
  const result = drawByMode(base, mode, rules)
  expect(modeForVersion(result.algorithmVersion)).toBe(mode)
  expect(result.algorithmVersion).toMatch(/-rules-v3$/)
  expect(drawByMode({ ...base, players: [...base.players].reverse() }, mode, [...rules].reverse())).toEqual(result)
  expect(new Set(Array.from({ length: 10 }, (_, i) =>
    JSON.stringify(drawByMode({ ...base, seed: 'seed-' + i }, mode, rules).teams))).size).toBeGreaterThan(1)
  expect(result.teams.flatMap(team => team.playerIds).sort()).toEqual(base.players.map(player => player.id).sort())
  expect(brokenRule(rules, result.teams)).toBeUndefined()
  expect(result.teams.map(team => team.playerIds.length).sort()).toEqual([3, 4, 4])
  for (const team of result.teams) {
    expect(team.reserveIds).toHaveLength(team.playerIds.length - 2)
    expect(team.reserveIds).not.toContain(team.playerIds[0])
    expect(base.players.find(player => player.id === team.playerIds[0])!.isGoalkeeper).toBe(true)
  }
  const means = result.teams.map(team => team.skillMean)
  expect(result.balanceScore).toBe(Math.max(...means) - Math.min(...means))
})

it.each([
  [[together, { kind: 'together', player: 'p1', other: 'p2' }, { kind: 'apart', player: 'p0', other: 'p2' }], /juntos e separados/],
  [[together, { kind: 'fixed', player: 'p0', team: 0 }, { kind: 'fixed', player: 'p1', team: 1 }], /times diferentes/],
  [[together, { kind: 'together', player: 'p1', other: 'p2' }, { kind: 'together', player: 'p2', other: 'p3' }], /tamanho máximo/],
  [[{ kind: 'fixed', player: 'p6', team: 0 }], /indisponível/],
  [[{ kind: 'fixed', player: 'p0', team: 2 }], /desativado/],
] satisfies [DrawRule[], RegExp][])('explica conflitos em %j', (rules, message) => {
  expect(() => drawByMode(input(6, 2), 'classic', rules)).toThrow(message)
})

it('rejeita concentração de goleiros quando falta cobertura', () => {
  expect(() => drawByMode(input(6, 2, 2), 'classic', [together])).toThrow(/concentra goleiros/)
})

it.each([2, 3])('coincide com enumeração exaustiva em 120 casos de %i times', teamCount => {
  const edges: DrawRule[] = [together, apart, fixed,
    { kind: 'apart', player: 'p0', other: 'p2' },
    { kind: 'apart', player: 'p0', other: 'p1' },
    { kind: 'apart', player: 'p3', other: 'p0' },
    { kind: 'apart', player: 'p3', other: 'p1' },
    { kind: 'apart', player: 'p3', other: 'p2' },
    { kind: 'fixed', player: 'p4', team: 0 },
  ]
  for (let i = 0; i < 120; i++) {
    const base = input(5 + i % 2, teamCount, i % 6)
    const rules = edges.filter((_, bit) => ((i + 1) * 131 & (1 << bit)) !== 0)
    const mode = modes[i % modes.length]!
    expect(rules.length).toBeGreaterThan(0)
    if (feasible(base, rules, mode)) {
      const result = drawByMode(base, mode, rules)
      expect(brokenRule(rules, result.teams)).toBeUndefined()
    } else {
      expect(() => drawByMode(base, mode, rules)).toThrow(DrawInputError)
    }
  }
})

it('limita elencos condicionados e distribui goleiros em 120 jogadores', () => {
  expect(() => drawByMode(input(121, 3), 'classic', [fixed])).toThrow(/até 120/)
  const base = input(120, 3, 40)
  const rules: DrawRule[] = Array.from({ length: 13 }, (_, i) => ({ kind: 'fixed', player: 'p' + i, team: 0 }))
  const result = drawByMode(base, 'competitive', rules)
  expect(result.teams.map(team => team.goalkeeperCount).sort()).toEqual([13, 13, 14])
})

it('distingue o limite de busca de uma inviabilidade demonstrada', () => {
  const rules: DrawRule[] = Array.from({ length: 13 }, (_, group) =>
    Array.from({ length: 4 }, (_, offset) => ({
      kind: 'together' as const, player: 'p' + (group * 5 + offset), other: 'p' + (group * 5 + offset + 1),
    }))).flat()
  // Cada time de 22 comporta até quatro dos treze grupos de cinco.
  expect(() => drawByMode(input(66, 3), 'classic', rules)).toThrow(/limite de combinações/)
})
