import { createFutebolApiServices } from '../lib/api/services'
import { ApiError } from '../lib/api/client'
import { loadMatchHistory, loadSavedMatch, saveMatchDraw } from './match-service'
import { group, matchId, payload, saved } from './test-fixtures'

describe('match-service through the authenticated API', () => {
  it('rejects corrupt or incomplete historical graphs returned by the API', async () => {
    const variants = [
      { teams: saved.teams.map(t => ({ ...t, team_index: 9 })) },
      { runs: saved.runs.map(r => ({ ...r, run_number: 2 })) },
      { assignments: saved.assignments.map(a => ({ ...a, starts_as_reserve: true })) },
      { assignments: saved.assignments.map(a => ({ ...a, team_id: saved.teams[0]!.id })) },
      { participants: saved.participants.map(p => ({ ...p, attendance_status: 'absent' })) },
      { teams: [] }, { assignments: [] }, { runs: [] },
      { runs: [...saved.runs, { ...saved.runs[0], id: 'other' }] },
    ]
    const transport = vi.fn<typeof fetch>()
    const client = createFutebolApiServices('http://localhost:8787', () => Promise.resolve('synthetic-access'), transport)
    for (const variant of variants) {
      transport.mockResolvedValueOnce(Response.json({ ...saved, ...variant }))
      await expect(loadSavedMatch(client, group.id, matchId)).rejects.toThrow('incompleto')
    }
    client.close()
  })

  it('does not announce a successful save with a missing or different returned ID', async () => {
    const transport = vi.fn<typeof fetch>()
    const client = createFutebolApiServices('http://localhost:8787', () => Promise.resolve('synthetic-access'), transport)
    for (const id of [null, group.id]) {
      transport.mockResolvedValueOnce(Response.json({ id }))
      await expect(saveMatchDraw(client, matchId, payload)).rejects.toThrow('Resposta de salvamento inválida')
    }
    client.close()
  })

  it('aborts a pending save after the existing API timeout without claiming rollback', async () => {
    vi.useFakeTimers()
    const transport = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    const client = createFutebolApiServices('http://localhost:8787', () => Promise.resolve('synthetic-access'), transport)
    try {
      const assertion = expect(saveMatchDraw(client, matchId, payload)).rejects.toMatchObject({ name: 'AbortError' })
      await vi.advanceTimersByTimeAsync(20000)
      await assertion
      expect(transport.mock.calls[0]![1]?.signal?.aborted).toBe(true)
    } finally { client.close(); vi.useRealTimers() }
  })

  it('does not treat denied reads as an empty or valid history', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 403 }))
    const client = createFutebolApiServices('http://localhost:8787', () => Promise.resolve('synthetic-access'), transport)
    await expect(loadSavedMatch(client, group.id, matchId)).rejects.toBeInstanceOf(ApiError)
    await expect(loadMatchHistory(client, group.id)).rejects.toMatchObject({ status: 403 })
    client.close()
  })
})
