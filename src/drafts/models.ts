import { brokenRule, ruleAvailable, RULE_LIMIT, type DrawRule } from '../draw/draw-rules'
import { validateAdjustment, type AdjustmentState, type EditableTeam } from '../draw/adjustments'
import type { DrawPlayer, DrawResult } from '../draw/engine'
import { DRAW_MODES, meanGap } from '../draw/smart-engine'
import type { PlayerInput } from '../groups/group-service'
import { buildDrawPayload, type GameConfig, type SaveDrawPayload } from '../matches/draw-payload'

export type GameStep = 'details' | 'participants' | 'result'
export type DetailsInput = Omit<GameConfig, 'playersOnCourt'> & { playersOnCourt: string }
export type DrawAttempt = { id: string; payload: SaveDrawPayload }
export type MatchDraft = {
  step: GameStep
  config: GameConfig
  details: DetailsInput
  selected: string[]
  rules: DrawRule[]
  runs: DrawResult[]
  adjustment: AdjustmentState | null
  drawContext: string
  historySummary: string | null
  attempt: DrawAttempt | null
}

type Fields = Record<string, unknown>
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE = /^\d{4,6}-\d{2}-\d{2}$/
const TIME = /^\d{2}:\d{2}$/
const MAX_ENTRIES = 4096
const POSITION = ['goalkeeper', 'defense', 'midfield', 'attack', 'any']

function fields(value: unknown, required: string[], optional: string[] = []): value is Fields {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(Object.getPrototypeOf(value) ?? value) === null && required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => required.includes(key) || optional.includes(key))
}
function text(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length <= limit
}
function number(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}
function whole(value: unknown, min: number, max: number): value is number {
  return number(value, min, max) && Number.isInteger(value)
}
function uuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}
function list(value: unknown, limit = MAX_ENTRIES): value is unknown[] {
  return Array.isArray(value) && value.length <= limit && Object.keys(value).length === value.length
}
function ids(value: unknown): value is string[] {
  return list(value) && value.every(uuid) && new Set(value).size === value.length
}
function nullableText(value: unknown, limit: number) { return value === null || text(value, limit) }
function position(value: unknown): value is PlayerInput['preferredPosition'] { return value === null || (typeof value === 'string' && POSITION.includes(value)) }
function skill(value: unknown) { return number(value, 1, 5) && Number.isInteger(value * 2) }

export type PlayerDraft = PlayerInput & { submitted?: true }

export function isPlayerDraft(value: unknown): value is PlayerDraft {
  return fields(value, ['active', 'isGoalkeeper', 'name', 'nickname', 'preferredPosition', 'skillRating'], ['submitted'])
    && (value.submitted === undefined || value.submitted === true)
    && typeof value.active === 'boolean' && typeof value.isGoalkeeper === 'boolean'
    && text(value.name, 80) && nullableText(value.nickname, 40) && position(value.preferredPosition) && skill(value.skillRating)
}

function config(value: unknown, partial: boolean): boolean {
  return fields(value, ['name', 'matchDate', 'matchTime', 'playersOnCourt', 'teamCount'], ['drawMode', 'avoidRecentRepeats'])
    && text(value.name, 80)
    && typeof value.matchDate === 'string' && (DATE.test(value.matchDate) || (partial && value.matchDate === ''))
    && typeof value.matchTime === 'string' && (TIME.test(value.matchTime) || value.matchTime === '')
    && (partial ? text(value.playersOnCourt, 32) : whole(value.playersOnCourt, 1, 20))
    && (value.teamCount === 2 || value.teamCount === 3)
    && (value.drawMode === undefined || (typeof value.drawMode === 'string' && Object.hasOwn(DRAW_MODES, value.drawMode)))
    && (value.avoidRecentRepeats === undefined || typeof value.avoidRecentRepeats === 'boolean')
}

function rule(value: unknown): value is DrawRule {
  if (fields(value, ['kind', 'player', 'team'])) return value.kind === 'fixed' && uuid(value.player) && whole(value.team, 0, 2)
  return fields(value, ['kind', 'player', 'other']) && (value.kind === 'together' || value.kind === 'apart')
    && uuid(value.player) && uuid(value.other) && value.player !== value.other
}

function team(value: unknown, withMetrics: boolean): value is EditableTeam {
  return fields(value, withMetrics
    ? ['playerIds', 'reserveIds', 'skillSum', 'skillMean', 'goalkeeperCount', 'missingPlayers'] : ['playerIds', 'reserveIds'])
    && ids(value.playerIds) && value.playerIds.length > 0 && ids(value.reserveIds)
    && (!withMetrics || (number(value.skillSum, 1, MAX_ENTRIES * 5) && number(value.skillMean, 1, 5)
      && whole(value.goalkeeperCount, 0, value.playerIds.length) && whole(value.missingPlayers, 0, 20)))
}

function lineup(teams: unknown, settings: GameConfig, players: Map<string, DrawPlayer>, rules: DrawRule[], withMetrics: boolean) {
  if (!list(teams, 3) || teams.length !== settings.teamCount || !teams.every(value => team(value, withMetrics))) return false
  const all = teams.flatMap(entry => entry.playerIds)
  if (all.length !== players.size || !all.every(id => players.has(id))) return false
  if (rules.length && settings.drawMode !== 'classic'
    && meanGap(teams.map(entry => entry.playerIds.filter(id => players.get(id)?.isGoalkeeper).length)) > 1) return false
  return !validateAdjustment({ teams, playersOnCourt: settings.playersOnCourt }, players) && !brokenRule(rules, teams)
}

function validDraw(draft: MatchDraft) {
  if (!draft.runs.length) return draft.step !== 'result' && !draft.adjustment && draft.drawContext === '' && !draft.attempt
  if (!draft.adjustment || !fields(draft.adjustment, ['teams', 'playersOnCourt'])
    || draft.adjustment.playersOnCourt !== draft.config.playersOnCourt || draft.drawContext.length > 512_000) return false
  let context: unknown
  try { context = JSON.parse(draft.drawContext) } catch { return false }
  if (!Array.isArray(context) || context.length !== 3 || JSON.stringify(context[0]) !== JSON.stringify(draft.config)
    || JSON.stringify(context[1]) !== JSON.stringify(draft.rules) || !list(context[2])) return false
  const players = new Map<string, DrawPlayer>()
  const selected = new Set(draft.selected)
  for (const entry of context[2]) {
    if (!fields(entry, ['id', 'skillRating', 'isGoalkeeper', 'preferredPosition']) || !uuid(entry.id)
      || !selected.has(entry.id) || players.has(entry.id) || !skill(entry.skillRating)
      || typeof entry.isGoalkeeper !== 'boolean' || !position(entry.preferredPosition)) return false
    players.set(entry.id, { id: entry.id, skillRating: Number(entry.skillRating), isGoalkeeper: entry.isGoalkeeper })
  }
  return draft.rules.every(entry => ruleAvailable(entry, new Set(players.keys()), draft.config.teamCount))
    && lineup(draft.adjustment.teams, draft.config, players, draft.rules, false)
    && draft.runs.every(run => fields(run, ['seed', 'algorithmVersion', 'balanceScore', 'teams'])
      && typeof run.seed === 'string' && /^[0-9a-f]{32}$/.test(run.seed)
      && text(run.algorithmVersion, 80) && run.algorithmVersion.length > 0 && number(run.balanceScore, 0, 100_000)
      && lineup(run.teams, draft.config, players, draft.rules, true))
}

function validAttempt(draft: MatchDraft, groupId: string) {
  if (!draft.attempt) return true
  const { id, payload } = draft.attempt
  if (draft.step !== 'result' || !draft.adjustment || !fields(draft.attempt, ['id', 'payload']) || !uuid(id)
    || !fields(payload, ['group_id', 'name', 'match_date', 'match_time', 'team_count', 'players_on_court', 'participants', 'teams', 'assignments', 'draw_runs'])
    || !list(payload.participants) || !list(payload.teams, 3) || !list(payload.assignments) || !list(payload.draw_runs)) return false
  const participants = []
  for (const p of payload.participants) {
    if (!fields(p, ['player_id', 'player_name_snapshot', 'player_nickname_snapshot', 'skill_rating_snapshot', 'is_goalkeeper_snapshot', 'preferred_position_snapshot'])
      || !uuid(p.player_id) || !text(p.player_name_snapshot, 80) || !nullableText(p.player_nickname_snapshot, 40)
      || !skill(p.skill_rating_snapshot) || typeof p.is_goalkeeper_snapshot !== 'boolean' || !position(p.preferred_position_snapshot)) return false
    participants.push({
      id: p.player_id, group_id: groupId, name: p.player_name_snapshot, nickname: p.player_nickname_snapshot,
      skill_rating: Number(p.skill_rating_snapshot), is_goalkeeper: p.is_goalkeeper_snapshot,
      preferred_position: p.preferred_position_snapshot, active: true, created_at: '', updated_at: '',
    })
  }
  try {
    const rebuilt = buildDrawPayload(groupId, draft.config, participants, draft.runs, draft.adjustment)
    return JSON.stringify(rebuilt) === JSON.stringify(payload)
  } catch { return false }
}

export function isMatchDraft(value: unknown, groupId: string): value is MatchDraft {
  if (!fields(value, ['step', 'config', 'details', 'selected', 'rules', 'runs', 'adjustment', 'drawContext', 'historySummary', 'attempt'])
    || (value.step !== 'details' && value.step !== 'participants' && value.step !== 'result')
    || !config(value.config, false) || !config(value.details, true) || !ids(value.selected)
    || !list(value.rules, RULE_LIMIT) || !value.rules.every(rule) || !list(value.runs)
    || typeof value.drawContext !== 'string' || !nullableText(value.historySummary, 400)
    || (value.attempt !== null && !fields(value.attempt, ['id', 'payload']))) return false
  const draft = value as MatchDraft
  const selected = new Set(draft.selected)
  return draft.rules.every(entry => ruleAvailable(entry, selected, draft.config.teamCount))
    && validDraw(draft) && validAttempt(draft, groupId)
}
