import type { FutebolSupabaseClient } from '../lib/supabase/client'
import { loadMatchHistory, loadSavedMatch, saveMatchDraw, SAVE_TIMEOUT_MS } from './match-service'
import { group, matchId, payload, saved } from './test-fixtures'

function query(data: unknown, error: unknown = null) {
  const response = Promise.resolve({ data, error })
  const q = { select: vi.fn(() => q), eq: vi.fn(() => q), order: vi.fn(() => q), range: vi.fn(() => q), single: vi.fn(() => q), then: response.then.bind(response) }
  return q
}
describe('match-service', () => {
  it('rejeita grafos historicamente corrompidos mesmo com contagens corretas', async () => {
    const variants = [
      { teams: saved.teams.map((t) => ({ ...t, team_index: 9 })) },
      { draw_runs: saved.runs.map((r) => ({ ...r, run_number: 2 })) },
      { team_assignments: saved.assignments.map((a) => ({ ...a, starts_as_reserve: true })) },
      { team_assignments: saved.assignments.map((a) => ({ ...a, team_id: saved.teams[0]!.id })) },
      { match_players: saved.participants.map((p) => ({ ...p, attendance_status: 'absent' })) },
    ]
    for (const variant of variants) {
      const data = { matches: saved.match, match_players: saved.participants, teams: saved.teams, team_assignments: saved.assignments, draw_runs: saved.runs, ...variant }
      const client = { from: vi.fn((name: keyof typeof data) => query(data[name])) } as unknown as FutebolSupabaseClient
      await expect(loadSavedMatch(client, group.id, matchId)).rejects.toThrow('incompleto')
    }
  })
  it('salva exclusivamente pela RPC e exige o ID correto na resposta', async () => {
    const response = vi.fn().mockResolvedValue({ data: matchId, error: null })
    const rpc = vi.fn(() => ({ abortSignal: response })), from = vi.fn()
    const client = { rpc, from } as unknown as FutebolSupabaseClient
    await expect(saveMatchDraw(client, matchId, payload)).resolves.toBe(matchId)
    expect(rpc).toHaveBeenCalledWith('save_match_draw', { target_match_id: matchId, payload })
    expect(from).not.toHaveBeenCalled()
    for (const data of [null, 'outro-id']) { response.mockResolvedValue({ data, error: null }); await expect(saveMatchDraw(client, matchId, payload)).rejects.toThrow('Resposta') }
    response.mockResolvedValue({ data: null, error: { code: '42501' } })
    await expect(saveMatchDraw(client, matchId, payload)).rejects.toEqual({ code: '42501' })
  })
  it('aborta uma chamada pendente após o timeout, sem afirmar rollback', async () => {
    vi.useFakeTimers()
    try {
      const abortSignal = vi.fn((signal: AbortSignal) => new Promise((resolve) => signal.addEventListener('abort', () => resolve({ data: null, error: { code: 'ABORT' } }))))
      const client = { rpc: vi.fn(() => ({ abortSignal })) } as unknown as FutebolSupabaseClient
      const result = expect(saveMatchDraw(client, matchId, payload)).rejects.toEqual({ code: 'ABORT' })
      await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS)
      await result
      expect(abortSignal.mock.calls[0]![0].aborted).toBe(true)
    } finally { vi.useRealTimers() }
  })
  it('filtra drawn por grupo, ordena data/hora e pagina sem buscar drafts', async () => {
    const q = query([saved.match]), client = { from: vi.fn(() => q) } as unknown as FutebolSupabaseClient
    expect(await loadMatchHistory(client, group.id, 1)).toEqual([saved.match])
    expect(q.eq.mock.calls).toEqual([['group_id', group.id], ['status', 'drawn']])
    expect(q.order.mock.calls).toEqual([['match_date', { ascending: false }], ['match_time', { ascending: false, nullsFirst: false }], ['created_at', { ascending: false }], ['id', { ascending: false }]])
    expect(q.range).toHaveBeenCalledWith(50, 99)
  })
  it('lê detalhe completo por snapshots, sem consultar players', async () => {
    const tables = { matches: query(saved.match), match_players: query(saved.participants), teams: query(saved.teams), team_assignments: query(saved.assignments), draw_runs: query(saved.runs) }
    const from = vi.fn((name: keyof typeof tables) => tables[name]), client = { from } as unknown as FutebolSupabaseClient
    expect(await loadSavedMatch(client, group.id, matchId)).toEqual(saved)
    expect(from.mock.calls.map(([name]) => name)).not.toContain('players')
    for (const q of Object.values(tables)) expect(q.eq).toHaveBeenCalledWith('group_id', group.id)
    expect(tables.matches.eq).toHaveBeenCalledWith('status', 'drawn')
    expect(tables.match_players.eq).toHaveBeenCalledWith('match_id', matchId)
  })
  it('não apresenta detalhes incompletos, sem aceite único ou inacessíveis como válidos', async () => {
    for (const overrides of [{ teams: [] }, { team_assignments: [] }, { draw_runs: [] }, { draw_runs: [...saved.runs, { ...saved.runs[0], id: 'other' }] }]) {
      const data = { matches: saved.match, match_players: saved.participants, teams: saved.teams, team_assignments: saved.assignments, draw_runs: saved.runs, ...overrides }
      const client = { from: vi.fn((name: keyof typeof data) => query(data[name])) } as unknown as FutebolSupabaseClient
      await expect(loadSavedMatch(client, group.id, matchId)).rejects.toThrow('incompleto')
    }
    const client = { from: vi.fn(() => query(null, { code: '42501' })) } as unknown as FutebolSupabaseClient
    await expect(loadSavedMatch(client, group.id, matchId)).rejects.toEqual({ code: '42501' })
    await expect(loadMatchHistory(client, group.id)).rejects.toEqual({ code: '42501' })
  })
})
