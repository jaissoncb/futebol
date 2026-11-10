import { ALGORITHM_VERSION, drawTeams, mean, randomSource, shuffled, validate, type DrawInput, type DrawPlayer, type DrawTeam } from './engine'
import type { PreferredPosition } from '../groups/group-service'

export const DRAW_MODES = {
  classic: { label: 'Clássico', version: ALGORITHM_VERSION, description: 'Aproxima as médias gerais e sorteia as reservas.' },
  balanced: { label: 'Equilibrado', version: 'balanced-positions-v2', description: 'Aproxima as médias gerais e dos titulares, distribui goleiros e considera as preferências de posição disponíveis.' },
  competitive: { label: 'Competitivo', version: 'competitive-starters-v2', description: 'Prioriza médias próximas entre titulares. Também considera o elenco completo e, com peso menor, as preferências de posição.' },
} as const

export type DrawMode = keyof typeof DRAW_MODES
type SmartMode = Exclude<DrawMode, 'classic'>
type PositionedPlayer = DrawPlayer & { preferredPosition?: PreferredPosition | null }
type SmartInput = DrawInput & { players: readonly PositionedPlayer[] }
type Slot = { team: number; starter: boolean; player: PositionedPlayer }
const POSITIONS = ['defense', 'midfield', 'attack'] as const

export function meanGap(means: readonly number[]) {
  return Math.max(...means) - Math.min(...means)
}

export function modeForVersion(version: string): DrawMode | undefined {
  return (Object.keys(DRAW_MODES) as DrawMode[]).find(mode => DRAW_MODES[mode].version === version)
}

export function drawByMode(input: SmartInput, mode: DrawMode = 'classic') {
  if (mode === 'classic') return drawTeams(input)
  validate(input)
  const random = randomSource(input.seed)
  const ordered = [...input.players].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const players = shuffled(ordered, random)
  const keepers = players.filter(player => player.isGoalkeeper)
  const outfield = players.filter(player => !player.isGoalkeeper)
  const sizes = shuffled(Array.from({ length: input.teamCount }, (_, i) =>
    Math.floor(players.length / input.teamCount) + Number(i < players.length % input.teamCount)), random)
  const teams: PositionedPlayer[][] = sizes.map(() => [])
  const teamOrder = shuffled(teams.map((_, index) => index), random)

  // Allocate keepers in rounds, then fill the remaining slots in lottery order.
  for (const keeper of keepers) {
    const available = teamOrder.filter(index => teams[index]!.length < sizes[index]!)
    const index = available.reduce((first, next) => teams[next]!.length < teams[first]!.length ? next : first)
    teams[index]!.push(keeper)
  }
  for (const [index, team] of teams.entries()) {
    const firstKeeper = team.shift()
    const fill = sizes[index]! - team.length - Number(Boolean(firstKeeper))
    team.push(...outfield.splice(0, fill))
    team.splice(0, team.length, ...shuffled(team, random))
    if (firstKeeper) team.unshift(firstKeeper)
  }

  const slots = teams.flatMap((team, index) => team.map((player, rank) => ({
    team: index, starter: rank < input.playersOnCourt, player,
  })))
  // Only exchange equivalent slots. The lottery determines who starts, independently of ratings.
  const buckets = [
    slots.filter(slot => slot.starter && slot.player.isGoalkeeper),
    slots.filter(slot => slot.starter && !slot.player.isGoalkeeper),
    slots.filter(slot => !slot.starter && slot.player.isGoalkeeper),
    slots.filter(slot => !slot.starter && !slot.player.isGoalkeeper),
  ].filter(bucket => new Set(bucket.map(slot => slot.team)).size > 1)
  const positions = POSITIONS.filter(position =>
    slots.filter(slot => slot.starter && !slot.player.isGoalkeeper && slot.player.preferredPosition === position).length >= 2)
  const score = () => candidateScore(slots, sizes, input.playersOnCourt, mode, positions)
  let best = slots.map(slot => slot.player)
  let bestScore = score()

  for (let restart = 0; restart < 4 && buckets.length; restart++) {
    if (restart > 0) {
      for (const bucket of buckets) {
        const permutation = shuffled(bucket.map(slot => slot.player), random)
        bucket.forEach((slot, index) => { slot.player = permutation[index]! })
      }
    }
    let currentScore = score()
    if (currentScore < bestScore) {
      bestScore = currentScore
      best = slots.map(slot => slot.player)
    }
    for (let attempt = 0; attempt < 180; attempt++) {
      const bucket = buckets[Math.floor(random() * buckets.length)]!
      const first = bucket[Math.floor(random() * bucket.length)]!
      const second = bucket[Math.floor(random() * bucket.length)]!
      if (first.team === second.team) continue
      ;[first.player, second.player] = [second.player, first.player]
      const nextScore = score()
      if (nextScore <= currentScore) currentScore = nextScore
      else [first.player, second.player] = [second.player, first.player]
      if (currentScore < bestScore) {
        bestScore = currentScore
        best = slots.map(slot => slot.player)
      }
    }
  }

  const result: DrawTeam[] = sizes.map((size, index) => {
    const team = best.filter((_, slot) => slots[slot]!.team === index)
    return {
      playerIds: team.map(player => player.id),
      reserveIds: team.slice(input.playersOnCourt).map(player => player.id),
      skillSum: team.reduce((sum, player) => sum + player.skillRating, 0),
      skillMean: mean(team),
      goalkeeperCount: team.filter(player => player.isGoalkeeper).length,
      missingPlayers: Math.max(0, input.playersOnCourt - size),
    }
  })
  return {
    teams: result,
    balanceScore: meanGap(result.map(team => team.skillMean)),
    seed: input.seed,
    algorithmVersion: DRAW_MODES[mode].version,
  }
}

function candidateScore(slots: readonly Slot[], sizes: readonly number[], playersOnCourt: number, mode: SmartMode, positions: readonly PreferredPosition[]) {
  const totals = sizes.map(() => 0)
  const starters = sizes.map(() => 0)
  const keeperStrength = sizes.map(() => 0)
  const positionCounts = positions.map(() => sizes.map(() => 0))
  for (const { team, player, starter } of slots) {
    totals[team]! += player.skillRating
    if (!starter) continue
    starters[team]! += player.skillRating
    if (player.isGoalkeeper) keeperStrength[team] = Math.max(keeperStrength[team]!, player.skillRating)
    else positionCounts.forEach((counts, index) => {
      if (player.preferredPosition === positions[index]) counts[team]!++
    })
  }
  const rosterGap = meanGap(totals.map((sum, index) => sum / sizes[index]!))
  const starterGap = meanGap(starters.map((sum, index) => sum / Math.min(sizes[index]!, playersOnCourt)))
  const positionGap = positionCounts.length ? positionCounts.reduce((sum, counts) => sum + meanGap(counts), 0) / positionCounts.length : 0
  if (mode === 'competitive') return 4 * starterGap + rosterGap + 0.05 * positionGap
  const coveredKeeperStrength = keeperStrength.filter(strength => strength > 0)
  const keeperGap = coveredKeeperStrength.length ? meanGap(coveredKeeperStrength) : 0
  return rosterGap + starterGap + 0.2 * keeperGap + 0.3 * positionGap
}
