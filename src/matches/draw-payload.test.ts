import { buildDrawPayload } from './draw-payload'
import { config, draw, final, group, players } from './test-fixtures'

describe('contrato do payload da Fase 7', () => {
  it('envia configuração e todos snapshots, sem identidade/status/IDs de filhos', () => {
    const p = buildDrawPayload(group.id, config, players, [draw], final)
    expect(p).toMatchObject({ group_id: group.id, name: config.name, match_date: '2026-09-12', match_time: '20:00', team_count: 2, players_on_court: 1 })
    expect(p.participants[0]).toEqual({ player_id: players[0]!.id, player_name_snapshot: 'Pessoa 1', player_nickname_snapshot: 'P1',
      skill_rating_snapshot: 3, is_goalkeeper_snapshot: false, preferred_position_snapshot: 'attack' })
    expect(Object.keys(p).sort()).toEqual(['assignments','draw_runs','group_id','match_date','match_time','name','participants','players_on_court','team_count','teams'].sort())
    expect(p.teams).toEqual([{ team_index: 1, name: 'Azul', color: 'blue' }, { team_index: 2, name: 'Vermelho', color: 'red' }])
    expect(p.assignments.every((a) => a.assignment_source === 'draw')).toBe(true)
    expect(p.assignments.filter((a) => a.starts_as_reserve)).toHaveLength(2)
  })
  it('preserva os runs em ordem e aceita somente o último, sem score artificial', () => {
    const p = buildDrawPayload(group.id, config, players, [draw, { ...draw, seed: 'B', balanceScore: 0.333333 }, { ...draw, seed: 'C' }], final)
    expect(p.draw_runs.map((r) => [r.run_number, r.seed, r.accepted])).toEqual([[1, 'fixture-A', false], [2, 'B', false], [3, 'C', true]])
    expect(p.draw_runs[1]).toMatchObject({ algorithm_version: draw.algorithmVersion, balance_score: 0.333333 })
  })
  it('marca manual por troca de time e volta a draw quando retorna ao slot original', () => {
    const changed = structuredClone(final)
    const a = changed.teams[0]!.playerIds[0]!, b = changed.teams[1]!.playerIds[0]!
    changed.teams[0]!.playerIds[0] = b; changed.teams[1]!.playerIds[0] = a
    changed.teams[0]!.reserveIds = changed.teams[0]!.reserveIds.map((id) => id === a ? b : id)
    changed.teams[1]!.reserveIds = changed.teams[1]!.reserveIds.map((id) => id === b ? a : id)
    const p = buildDrawPayload(group.id, config, players, [draw], changed)
    expect(p.assignments.filter((row) => row.assignment_source === 'manual').map((row) => row.player_id).sort()).toEqual([a, b].sort())
    expect(buildDrawPayload(group.id, config, players, [draw], final).assignments.every((row) => row.assignment_source === 'draw')).toBe(true)
  })
  it('marca manual quando apenas titular/reserva muda', () => {
    const changed = structuredClone(final), team = changed.teams[0]!
    team.reserveIds = team.playerIds.filter((id) => !team.reserveIds.includes(id))
    const p = buildDrawPayload(group.id, config, players, [draw], changed)
    expect(p.assignments.filter((row) => row.assignment_source === 'manual')).toHaveLength(2)
    expect(p.draw_runs[0]!.seed).toBe(draw.seed)
  })
  it('usa os dados no momento do salvamento e normaliza opcionais', () => {
    const changed = players.map((p) => ({ ...p, name: 'Nome no save', nickname: null, is_goalkeeper: true }))
    const p = buildDrawPayload(group.id, { ...config, name: ' ', matchTime: '' }, changed, [draw], final)
    expect(p.name).toBeNull(); expect(p.match_time).toBeNull()
    expect(p.participants.every((p) => p.player_name_snapshot === 'Nome no save' && p.is_goalkeeper_snapshot)).toBe(true)
    expect(() => buildDrawPayload(group.id, config, [], [draw], final)).toThrow('Participante indisponível')
  })
})
