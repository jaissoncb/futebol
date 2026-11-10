import { DrawInputError, mean, randomSource, shuffled, validate, type DrawInput, type DrawPlayer, type DrawTeam } from './engine'

export type DrawRule =
  | { kind: 'together' | 'apart'; player: string; other: string }
  | { kind: 'fixed'; player: string; team: number }

export const RULE_LIMIT = 60
const PLAYER_LIMIT = 120
const SEARCH_LIMIT = 40_000
const CANDIDATE_LIMIT = 160

export function ruleKey(rule: DrawRule) {
  return JSON.stringify(rule.kind === 'fixed'
    ? [rule.kind, rule.player, rule.team]
    : [rule.kind, ...[rule.player, rule.other].sort()])
}

export function ruleAvailable(rule: DrawRule, ids: ReadonlySet<string>, teamCount: number) {
  return ids.has(rule.player) && (rule.kind === 'fixed'
    ? Number.isInteger(rule.team) && rule.team >= 0 && rule.team < teamCount
    : ids.has(rule.other) && rule.player !== rule.other)
}

export function brokenRule(rules: readonly DrawRule[], teams: readonly { playerIds: string[] }[]) {
  const assigned = new Map(teams.flatMap((team, index) => team.playerIds.map(id => [id, index] as const)))
  return rules.find(rule => {
    const team = assigned.get(rule.player)
    if (team === undefined) return true
    if (rule.kind === 'fixed') return team !== rule.team
    const other = assigned.get(rule.other)
    return other === undefined || (rule.kind === 'together' ? team !== other : team === other)
  })
}

export function drawWithRules<P extends DrawPlayer>(
  input: DrawInput & { players: readonly P[] },
  rules: readonly DrawRule[],
  score: (teams: readonly P[][]) => number,
  name: (id: string) => string,
  balanceKeepers: boolean,
) {
  validate(input)
  const { teamCount, playersOnCourt } = input
  if (input.players.length > PLAYER_LIMIT || rules.length > RULE_LIMIT) {
    throw new DrawInputError(`O sorteio com regras aceita até ${PLAYER_LIMIT} jogadores e ${RULE_LIMIT} regras. Reduza a seleção ou remova regras.`)
  }
  const players = [...input.players].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const ids = new Set(players.map(player => player.id))
  const parent = new Map(players.map(player => [player.id, player.id]))
  function root(id: string): string {
    const next = parent.get(id)!
    if (next === id) return id
    const representative = root(next)
    parent.set(id, representative)
    return representative
  }

  for (const rule of rules) {
    if (!ruleAvailable(rule, ids, teamCount)) {
      throw new DrawInputError('Uma regra usa um jogador indisponível ou um time desativado. Remova a regra ou revise os participantes.')
    }
    if (rule.kind === 'together') parent.set(root(rule.other), root(rule.player))
  }
  const components = new Map<string, P[]>()
  for (const player of players) {
    const id = root(player.id)
    const members = components.get(id) ?? []
    members.push(player)
    components.set(id, members)
  }
  const groups = [...components.values()].map((members, index) => ({
    members, index, keepers: members.filter(player => player.isGoalkeeper).length,
    apart: new Set<number>(), fixed: undefined as number | undefined,
  }))
  const groupOf = new Map(groups.flatMap(group => group.members.map(player => [player.id, group] as const)))
  for (const rule of rules) {
    const group = groupOf.get(rule.player)!
    if (rule.kind === 'fixed') {
      if (group.fixed !== undefined && group.fixed !== rule.team) {
        throw new DrawInputError(`O grupo de ${name(rule.player)} tem jogadores fixados em times diferentes. Revise as regras de time fixo e de jogar juntos.`)
      }
      group.fixed = rule.team
    } else if (rule.kind === 'apart') {
      const other = groupOf.get(rule.other)!
      if (other === group) {
        throw new DrawInputError(`${name(rule.player)} e ${name(rule.other)} precisam jogar juntos e separados. Revise as regras desses jogadores.`)
      }
      group.apart.add(other.index)
      other.apart.add(group.index)
    }
  }

  const maxSize = Math.ceil(players.length / teamCount)
  const minSize = Math.floor(players.length / teamCount)
  const keeperTotal = players.filter(player => player.isGoalkeeper).length
  const minKeepers = balanceKeepers ? Math.floor(keeperTotal / teamCount) : Number(keeperTotal >= teamCount)
  const maxKeepers = balanceKeepers ? Math.ceil(keeperTotal / teamCount)
    : Math.min(maxSize, Math.max(0, keeperTotal - Math.min(keeperTotal, teamCount) + 1))
  for (const group of groups) {
    const names = () => group.members.map(player => name(player.id)).join(', ')
    if (group.members.length > maxSize) throw new DrawInputError(`O grupo de ${names()} excede o tamanho máximo de um time. Remova uma regra de jogar juntos.`)
    if (group.keepers > maxKeepers) throw new DrawInputError(`O grupo de ${names()} concentra goleiros demais. Revise as regras de jogar juntos para distribuir os goleiros.`)
  }

  const random = randomSource(input.seed)
  const priority = shuffled(players, random)
  const ranks = new Map(priority.map((player, index) => [player.id, index]))
  const teams: P[][] = Array.from({ length: teamCount }, () => [])
  const keepers = teams.map(() => 0)
  const assigned = groups.map(() => -1)
  let nodes = 0
  let candidates = 0
  let best: { teams: P[][]; score: number }[] = []
  const seen = new Set<string>()

  function collect() {
    const key = assigned.join(',')
    if (seen.has(key)) return
    seen.add(key)
    candidates++
    const lineup = teams.map(team => {
      const ordered = [...team].sort((a, b) => ranks.get(a.id)! - ranks.get(b.id)!)
      const keeper = ordered.findIndex(player => player.isGoalkeeper)
      if (keeper > 0) ordered.unshift(ordered.splice(keeper, 1)[0]!)
      return ordered
    })
    const value = score(lineup)
    best.push({ teams: lineup, score: value })
    best.sort((a, b) => a.score - b.score)
    if (best.length > 5) best.pop()
  }

  // Each pass explores a seeded ordering. A quota spreads optimization across
  // branches, while the first pass can spend the full budget proving feasibility.
  for (let pass = 0; pass < 12 && candidates < CANDIDATE_LIMIT && nodes < SEARCH_LIMIT; pass++) {
    const order = shuffled(groups, random).sort((a, b) =>
      Number(b.fixed !== undefined) - Number(a.fixed !== undefined) ||
      b.apart.size - a.apart.size || b.members.length - a.members.length || b.keepers - a.keepers)
    const options = order.map(group => group.fixed === undefined
      ? shuffled(teams.map((_, index) => index), random)
      : [group.fixed])
    const stopAt = Math.min(CANDIDATE_LIMIT, candidates + 14)
    const seenBeforePass = candidates
    const passLimit = pass === 0 ? SEARCH_LIMIT : Math.min(SEARCH_LIMIT, nodes + 2_000)

    function search(depth: number, remaining: number, remainingKeepers: number): boolean {
      if (nodes >= passLimit || candidates >= stopAt) return false
      nodes++
      const sizeDeficit = teams.reduce((sum, team) => sum + Math.max(0, minSize - team.length), 0)
      const keeperDeficit = keepers.reduce((sum, count) => sum + Math.max(0, minKeepers - count), 0)
      const uncovered = keepers.filter(count => count === 0).length
      const requiredCoverage = Math.min(keeperTotal, teamCount) - (teamCount - uncovered)
      if (sizeDeficit > remaining || Math.max(keeperDeficit, requiredCoverage) > remainingKeepers) return true
      if (depth === order.length) {
        collect()
        return true
      }
      const group = order[depth]!
      for (const index of options[depth]!) {
        const team = teams[index]!
        if (team.length + group.members.length > maxSize || keepers[index]! + group.keepers > maxKeepers ||
          [...group.apart].some(other => assigned[other] === index)) continue
        team.push(...group.members)
        keepers[index]! += group.keepers
        assigned[group.index] = index
        const complete = search(depth + 1, remaining - group.members.length, remainingKeepers - group.keepers)
        assigned[group.index] = -1
        keepers[index]! -= group.keepers
        team.length -= group.members.length
        if (!complete) return false
      }
      return true
    }

    if (search(0, players.length, keeperTotal)) break
    if (pass === 0 && candidates === seenBeforePass) break
  }

  if (!best.length) {
    throw new DrawInputError(nodes >= SEARCH_LIMIT
      ? 'A busca atingiu o limite de combinações. Simplifique as regras e tente novamente.'
      : 'Não há escalação que respeite todas as regras, os tamanhos dos times e a distribuição dos goleiros. Revise separações, times fixos ou jogadores que precisam ficar juntos.')
  }
  const threshold = best[0]!.score + 0.05
  best = best.filter(candidate => candidate.score <= threshold)
  const result: DrawTeam[] = best[Math.floor(random() * best.length)]!.teams.map(team => ({
    playerIds: team.map(player => player.id),
    reserveIds: team.slice(playersOnCourt).map(player => player.id),
    skillSum: team.reduce((sum, player) => sum + player.skillRating, 0),
    skillMean: mean(team),
    goalkeeperCount: team.filter(player => player.isGoalkeeper).length,
    missingPlayers: Math.max(0, playersOnCourt - team.length),
  }))
  return result
}

export function describeRule(rule: DrawRule, name: (id: string) => string, teamNames: readonly string[]) {
  if (rule.kind === 'fixed') return `${name(rule.player)} no Time ${teamNames[rule.team] ?? 'indisponível'}`
  return `${name(rule.player)} e ${name(rule.other)}: ${(rule.kind === 'together' ? 'jogar juntos' : 'jogar separados')}`
}
