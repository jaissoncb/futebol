import { brokenRule, type DrawRule } from './draw-rules'
import { randomSource, type DrawInput, type DrawResult } from './engine'

type Team = { readonly playerIds: readonly string[]; readonly reserveIds: readonly string[] }
export type HistoricalSnapshot = readonly (readonly Team[])[]
type Weight = { roster: number; starters: number }
const SWAP_ATTEMPTS = 768
const ROSTER_TOLERANCE = 0.125
const STARTER_TOLERANCE = { balanced: 0.1, competitive: 0.05 }

function pairs(team: Team, visit: (first: string, second: string, starters: boolean) => void) {
  const reserves = new Set(team.reserveIds)
  for (const [index, first] of team.playerIds.entries()) {
    for (let next = index + 1; next < team.playerIds.length; next++) {
      const second = team.playerIds[next]!
      visit(first, second, !reserves.has(first) && !reserves.has(second))
    }
  }
}

export function historicalWeights(snapshot: HistoricalSnapshot, eligible: ReadonlySet<string>) {
  const weights = new Map<string, Map<string, Weight>>()
  for (const [index, match] of snapshot.entries()) {
    const recency = snapshot.length - index
    for (const team of match) {
      pairs({ playerIds: team.playerIds.filter(id => eligible.has(id)), reserveIds: team.reserveIds }, (first, second, starters) => {
        const [low, high] = first < second ? [first, second] : [second, first]
        const row = weights.get(low) ?? new Map<string, Weight>()
        const weight = row.get(high) ?? { roster: 0, starters: 0 }
        weight.roster += recency
        if (starters) weight.starters += recency
        row.set(high, weight)
        weights.set(low, row)
      })
    }
  }
  return weights
}

type Weights = ReturnType<typeof historicalWeights>
function pairWeight(weights: Weights, a: string, b: string) {
  return a < b ? weights.get(a)?.get(b) : weights.get(b)?.get(a)
}

export function repeatedPairs(teams: readonly Team[], weights: Weights) {
  let roster = 0
  let starters = 0
  for (const team of teams) {
    pairs(team, (a, b, starting) => {
      const weight = pairWeight(weights, a, b)
      if (weight?.roster) roster++
      if (starting && weight?.starters) starters++
    })
  }
  return { roster, starters }
}

/** Start at the existing result. Exchange only equivalent slots within fixed
 * skill limits measured against that result, never against the previous swap. */
export function diversify(input: DrawInput, baseline: DrawResult, mode: 'balanced' | 'competitive', rules: readonly DrawRule[], weights: Weights): DrawResult {
  const players = new Map(input.players.map(player => [player.id, player]))
  const teams = baseline.teams.map(team => ({
    ...team, playerIds: [...team.playerIds], reserveIds: [...team.reserveIds],
  }))
  const slots = teams.flatMap((team, index) => team.playerIds.map((id, rank) => ({
    team: index, rank, reserve: team.reserveIds.indexOf(id), keeper: players.get(id)!.isGoalkeeper,
  })))
  const counts = teams.map(team => team.playerIds.length - team.reserveIds.length)
  const totals = teams.map(team => team.skillSum)
  const starters = teams.map(team => team.playerIds.reduce((sum, id) =>
    sum + (team.reserveIds.includes(id) ? 0 : players.get(id)!.skillRating), 0))
  const gap = (sums: readonly number[], sizes: readonly number[]) => {
    const means = sums.map((sum, index) => sum / sizes[index]!)
    return Math.max(...means) - Math.min(...means)
  }
  const sizes = teams.map(team => team.playerIds.length)
  const rosterLimit = gap(totals, sizes) + ROSTER_TOLERANCE + 1e-9
  const starterLimit = gap(starters, counts) + STARTER_TOLERANCE[mode] + 1e-9
  const random = randomSource(`history-v4:${input.seed}`)

  function cost(slot: typeof slots[number], id: string) {
    const team = teams[slot.team]!
    let total = 0
    for (const [rank, other] of team.playerIds.entries()) {
      if (rank === slot.rank) continue
      const weight = pairWeight(weights, id, other)
      if (weight) total += weight.roster + (slot.reserve < 0 && !team.reserveIds.includes(other) ? weight.starters : 0)
    }
    return total
  }

  function replace(slot: typeof slots[number], id: string) {
    const team = teams[slot.team]!
    team.playerIds[slot.rank] = id
    if (slot.reserve >= 0) team.reserveIds[slot.reserve] = id
  }

  for (let attempt = 0; attempt < SWAP_ATTEMPTS && weights.size; attempt++) {
    const first = slots[Math.floor(random() * slots.length)]!
    const second = slots[Math.floor(random() * slots.length)]!
    if (first.team === second.team || first.keeper !== second.keeper || (first.reserve < 0) !== (second.reserve < 0)) continue
    const a = teams[first.team]!.playerIds[first.rank]!
    const b = teams[second.team]!.playerIds[second.rank]!
    const delta = players.get(b)!.skillRating - players.get(a)!.skillRating
    const nextTotals = [...totals]
    const nextStarters = [...starters]
    nextTotals[first.team]! += delta
    nextTotals[second.team]! -= delta
    if (first.reserve < 0) {
      nextStarters[first.team]! += delta
      nextStarters[second.team]! -= delta
    }
    if (gap(nextTotals, sizes) > rosterLimit || gap(nextStarters, counts) > starterLimit ||
      cost(first, b) + cost(second, a) >= cost(first, a) + cost(second, b)) continue
    replace(first, b)
    replace(second, a)
    if (rules.length && brokenRule(rules, teams)) {
      replace(first, a)
      replace(second, b)
      continue
    }
    totals.splice(0, totals.length, ...nextTotals)
    starters.splice(0, starters.length, ...nextStarters)
  }
  for (const [index, team] of teams.entries()) {
    team.skillSum = totals[index]!
    team.skillMean = team.skillSum / sizes[index]!
  }
  return { ...baseline, teams, balanceScore: gap(totals, sizes) }
}
