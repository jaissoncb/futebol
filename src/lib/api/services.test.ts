import { describe, expect, it, vi } from 'vitest'
import { createFutebolApiServices } from './services'
import { createGroup, createPlayer, loadGroupWorkspace, updateGroup, updatePlayer } from '../../groups/group-service'
import { loadMatchHistory, loadSavedMatch, saveMatchDraw } from '../../matches/match-service'
import { group, matchId, payload, players, saved } from '../../matches/test-fixtures'
import { ApiError } from './client'

describe('domain services through Futebol API', () => {
  it('reuses existing domain calls, supplies only memory Bearer and never forwards user ID', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation((url) => Promise.resolve(Response.json(
      (url as URL).pathname === '/workspace' ? { groups: [group], players } : { id: group.id })))
    const services = createFutebolApiServices('http://localhost:8787', () => Promise.resolve('synthetic-memory-access'), transport)
    expect(await loadGroupWorkspace(services)).toEqual({ groups: [group], players })
    const input = { name: 'Fixture', sport: 'futsal', defaultPlayersOnCourt: 1 }
    expect(await createGroup(services, input)).toBe(group.id)
    await updateGroup(services, group.id, input)
    const player = { active: true, isGoalkeeper: false, name: 'Fixture player', nickname: null, preferredPosition: null, skillRating: 3 }
    await createPlayer(services, group.id, player)
    await updatePlayer(services, players[0]!.id, player)
    for (const [url, options] of transport.mock.calls) {
      expect(url).toBeInstanceOf(URL)
      expect((url as URL).origin).toBe('http://localhost:8787')
      expect((url as URL).href).not.toContain('must-not-be-forwarded')
      expect(options).toMatchObject({ credentials: 'omit', cache: 'no-store', redirect: 'error',
        headers: { Authorization: 'Bearer synthetic-memory-access' } })
    }
    expect(transport.mock.calls[1]![1]?.body).toBe(JSON.stringify(input))
    expect(transport.mock.calls[4]![1]?.method).toBe('PATCH')
    services.close()
  })
  it('preserves save attempt ID/retry payload and checks returned ID; reads one graph snapshot', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation((url, options) => Promise.resolve(Response.json(
      options?.method === 'PUT' ? { id: matchId } : (url as URL).pathname.endsWith(matchId) ? saved : [saved.match])))
    const services = createFutebolApiServices('http://localhost:8787', () => Promise.resolve('synthetic-access'), transport)
    for (let i = 0; i < 2; i++) expect(await saveMatchDraw(services, matchId, payload)).toBe(matchId)
    expect(transport.mock.calls[0]![1]?.body).toBe(transport.mock.calls[1]![1]?.body)
    expect(await loadMatchHistory(services, group.id, 1)).toEqual([saved.match])
    expect((transport.mock.lastCall![0] as URL).search).toBe('?page=1')
    expect(await loadSavedMatch(services, group.id, matchId)).toEqual(saved)
    expect(transport).toHaveBeenCalledTimes(4)
    transport.mockResolvedValue(Response.json({ id: group.id }))
    await expect(saveMatchDraw(services, matchId, payload)).rejects.toThrow('Resposta de salvamento inválida')
    transport.mockResolvedValue(Response.json({ ...saved, assignments: [] }))
    await expect(loadSavedMatch(services, group.id, matchId)).rejects.toThrow('incompleto')
    services.close()
  })
  it('rejects invalid IDs/pages before HTTP and rejects late responses after session close', async () => {
    let release!: (value: Response) => void
    const transport = vi.fn<typeof fetch>().mockReturnValue(new Promise<Response>(resolve => { release = resolve }))
    const services = createFutebolApiServices('http://localhost:8787', () => Promise.resolve('synthetic-access'), transport)
    await expect(services.history('../../other')).rejects.toBeInstanceOf(ApiError)
    await expect(services.history(group.id, -1)).rejects.toBeInstanceOf(ApiError)
    expect(transport).not.toHaveBeenCalled()
    const pending = services.me()
    const assertion = expect(pending).rejects.toBeInstanceOf(ApiError)
    await Promise.resolve()
    services.close(); release(Response.json({ id: group.id, display_name: null }))
    await assertion
    expect(transport.mock.calls[0]![1]?.signal?.aborted).toBe(true)
    await expect(services.workspace()).rejects.toBeInstanceOf(ApiError)
  })
})
