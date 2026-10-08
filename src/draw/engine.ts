/** Pure domain input: the caller supplies only eligible players. */
export interface DrawPlayer {
  readonly id: string
  readonly skillRating: number
  readonly isGoalkeeper: boolean
}
export interface DrawInput {
  readonly players: readonly DrawPlayer[]
  readonly teamCount: number
  readonly playersOnCourt: number
  readonly seed: string
}
export interface DrawTeam {
  playerIds: string[]
  reserveIds: string[]
  skillSum: number
  skillMean: number
  goalkeeperCount: number
  missingPlayers: number
}
export const ALGORITHM_VERSION = 'balanced-candidates-v1'
export const DRAW_TUNING = Object.freeze({ candidates: 400, shortlist: 10, skillWeight: 1 })
export class DrawInputError extends Error {}

/** Four-word seeded PRNG; production supplies a fresh 128-bit Web Crypto seed. */
function randomSource(seed: string): () => number {
  const state: [number, number, number, number] = [0x9e3779b9, 0x243f6a88, 0xb7e15162, 0xdeadbeef]
  for (let i = 0; i < seed.length; i++) {
    const lane = i % 4
    state[lane] = Math.imul(state[lane]! ^ seed.charCodeAt(i), 16777619) >>> 0
  }
  let [a, b, c, d] = state
  const next = () => {
    const t = ((a + b | 0) + d | 0)
    d = d + 1 | 0
    a = b ^ b >>> 9
    b = c + (c << 3) | 0
    c = (c << 21 | c >>> 11) + t | 0
    return (t >>> 0) / 4294967296
  }
  for (let i = 0; i < 20; i++) next()
  return next
}
function shuffled<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j]!, result[i]!]
  }
  return result
}
function validate(input: DrawInput) {
  if (!input || !Array.isArray(input.players)) throw new DrawInputError('Informe os jogadores selecionados.')
  if (input.teamCount !== 2 && input.teamCount !== 3) throw new DrawInputError('Escolha 2 ou 3 times.')
  if (!Number.isInteger(input.playersOnCourt) || input.playersOnCourt < 1 || input.playersOnCourt > 20) {
    throw new DrawInputError('Informe de 1 a 20 jogadores em quadra por time.')
  }
  if (typeof input.seed !== 'string' || !input.seed.trim()) throw new DrawInputError('Informe uma seed válida.')
  if (input.players.length < input.teamCount) throw new DrawInputError('Selecione pelo menos um jogador por time.')
  const ids = new Set<string>()
  for (const player of input.players as readonly DrawPlayer[]) {
    if (!player || typeof player.id !== 'string' || !player.id.trim() || ids.has(player.id)) {
      throw new DrawInputError('A seleção contém um jogador inválido ou repetido.')
    }
    if (!Number.isFinite(player.skillRating) || player.skillRating < 1 || player.skillRating > 5 ||
      !Number.isInteger(player.skillRating * 2) || typeof player.isGoalkeeper !== 'boolean') {
      throw new DrawInputError('Confira o nível e a indicação de goleiro dos jogadores.')
    }
    ids.add(player.id)
  }
}
function mean(players: readonly DrawPlayer[]): number {
  return players.reduce((total, player) => total + player.skillRating, 0) / players.length
}
function score(teams: readonly DrawPlayer[][]): number {
  const means = teams.map(mean)
  return (Math.max(...means) - Math.min(...means)) * DRAW_TUNING.skillWeight
}
/** No mutation, I/O, global randomness or React. Same input and seed reproduce the result. */
export function drawTeams(input: DrawInput) {
  validate(input)
  const random = randomSource(input.seed)
  const players = [...input.players].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const keepers = players.filter((player) => player.isGoalkeeper)
  const outfield = players.filter((player) => !player.isGoalkeeper)
  const baseSize = Math.floor(players.length / input.teamCount)
  const sizes = Array.from({ length: input.teamCount }, (_, i) => baseSize + (i < players.length % input.teamCount ? 1 : 0))
  const best: { teams: DrawPlayer[][]; score: number; key: string }[] = []
  for (let attempt = 0; attempt < DRAW_TUNING.candidates; attempt++) {
    const targets = shuffled(sizes, random)
    const teams: DrawPlayer[][] = targets.map(() => [])
    const shuffledKeepers = shuffled(keepers, random)
    const teamOrder = shuffled(targets.map((_, i) => i), random)
    const protectedCount = Math.min(keepers.length, input.teamCount)
    for (let i = 0; i < protectedCount; i++) teams[teamOrder[i]!]!.push(shuffledKeepers[i]!)
    const remaining = shuffled([...shuffledKeepers.slice(protectedCount), ...outfield], random)
    for (let i = 0; i < teams.length; i++) {
      while (teams[i]!.length < targets[i]!) teams[i]!.push(remaining.pop()!)
    }
    const candidateScore = score(teams)
    // Equivalent team permutations must not crowd the shortlist.
    const key = JSON.stringify(teams.map((team) => JSON.stringify(team.map((p) => p.id).sort())).sort())
    if (best.some((candidate) => candidate.key === key)) continue
    if (best.length === DRAW_TUNING.shortlist && candidateScore >= best[best.length - 1]!.score) continue
    best.push({ teams, score: candidateScore, key })
    best.sort((a, b) => a.score - b.score)
    if (best.length > DRAW_TUNING.shortlist) best.pop()
  }
  const selected = best[Math.floor(random() * best.length)]!
  const teams: DrawTeam[] = selected.teams.map((team) => {
    // Choose reserves AFTER scoring: skill must not determine who sits out.
    const order = shuffled(team, random)
    const keeperIndex = order.findIndex((player) => player.isGoalkeeper)
    if (keeperIndex > 0) [order[0], order[keeperIndex]] = [order[keeperIndex]!, order[0]!]
    return {
      playerIds: order.map((player) => player.id),
      reserveIds: order.slice(input.playersOnCourt).map((player) => player.id),
      skillSum: team.reduce((total, player) => total + player.skillRating, 0),
      skillMean: mean(team),
      goalkeeperCount: team.filter((player) => player.isGoalkeeper).length,
      missingPlayers: Math.max(0, input.playersOnCourt - team.length),
    }
  })
  return { teams, balanceScore: selected.score, seed: input.seed, algorithmVersion: ALGORITHM_VERSION }
}
export type DrawResult = ReturnType<typeof drawTeams>
