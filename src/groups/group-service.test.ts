import { createFutebolApiServices } from '../lib/api/services'
import { ApiError } from '../lib/api/client'
import { createGroup, createPlayer, loadGroupWorkspace, updateGroup, updatePlayer } from './group-service'
import { group, players } from '../matches/test-fixtures'

describe('group-service through the authenticated API', () => {
  it('keeps authorization errors visible to callers without a database fallback', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 403 }))
    const client = createFutebolApiServices('http://localhost:8787', () => Promise.resolve('synthetic-access'), transport)
    const input = { name: 'Grupo', sport: 'futsal', defaultPlayersOnCourt: 5 }
    const player = { active: true, name: 'Jogador', nickname: null, isGoalkeeper: false, preferredPosition: null, skillRating: 3 }
    for (const operation of [
      () => loadGroupWorkspace(client),
      () => createGroup(client, input),
      () => updateGroup(client, group.id, input),
      () => createPlayer(client, group.id, player),
      () => updatePlayer(client, players[0]!.id, player),
    ]) await expect(operation()).rejects.toMatchObject({ status: 403 })
    expect(transport).toHaveBeenCalledTimes(5)
    client.close()
  })

  it('refuses operations after logout before making a request', async () => {
    const transport = vi.fn<typeof fetch>()
    const client = createFutebolApiServices('http://localhost:8787', () => Promise.resolve('synthetic-access'), transport)
    client.close()
    await expect(loadGroupWorkspace(client)).rejects.toBeInstanceOf(ApiError)
    expect(transport).not.toHaveBeenCalled()
  })
})
