import type { FutebolSupabaseClient } from '../lib/supabase/client'
import { createGroup, createPlayer, loadGroupWorkspace, updateGroup, updatePlayer } from './group-service'

function queryResult<T>(data: T, error: { code: string } | null = null) {
  const response = Promise.resolve({ data, error })
  const query = {
    eq: vi.fn(() => query),
    insert: vi.fn(() => query),
    order: vi.fn(() => query),
    select: vi.fn(() => query),
    single: vi.fn(() => query),
    then: response.then.bind(response),
    update: vi.fn(() => query),
  }
  return query
}

describe('group-service', () => {
  it('rejeita updates sem linha visível em vez de anunciar sucesso', async () => {
    const query = queryResult(null, { code: 'PGRST116' })
    const client = { from: vi.fn(() => query) } as unknown as FutebolSupabaseClient
    await expect(updateGroup(client, 'inacessivel', { name: 'Grupo', sport: 'futsal', defaultPlayersOnCourt: 5 })).rejects.toEqual({ code: 'PGRST116' })
    await expect(updatePlayer(client, 'inacessivel', { active: false, name: 'Jogador', nickname: null, isGoalkeeper: false, preferredPosition: null, skillRating: 3 })).rejects.toEqual({ code: 'PGRST116' })
  })
  it('combina grupos visíveis com o papel do usuário e jogadores', async () => {
    const group = {
      id: 'group-a', name: 'Quarta', sport: 'futsal', default_players_on_court: 5,
      created_by: 'user-a', created_at: '', updated_at: '',
    }
    const player = {
      id: 'player-a', group_id: 'group-a', name: 'Ana', nickname: null, skill_rating: 4,
      is_goalkeeper: false, preferred_position: null, active: true, created_at: '', updated_at: '',
    }
    const tables = {
      groups: queryResult([group]),
      group_members: queryResult([{ group_id: 'group-a', role: 'owner' }]),
      players: queryResult([player]),
    }
    const client = { from: vi.fn((table: keyof typeof tables) => tables[table]) } as unknown as FutebolSupabaseClient

    const result = await loadGroupWorkspace(client, 'user-a')

    expect(result.groups).toEqual([{ ...group, role: 'owner' }])
    expect(result.players).toEqual([player])
    expect(tables.group_members.eq).toHaveBeenCalledWith('user_id', 'user-a')
  })

  it('cria grupos somente pela RPC atômica', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'group-a', error: null })
    const client = { rpc } as unknown as FutebolSupabaseClient

    await expect(createGroup(client, { name: '  Quinta  ', sport: ' futsal ', defaultPlayersOnCourt: 5 })).resolves.toBe('group-a')
    expect(rpc).toHaveBeenCalledWith('create_group', {
      default_players_on_court: 5,
      group_name: 'Quinta',
      sport: 'futsal',
    })
  })

  it('normaliza campos opcionais e nunca envia group_id ao editar jogador', async () => {
    const players = queryResult(null)
    const client = { from: vi.fn(() => players) } as unknown as FutebolSupabaseClient
    const input = {
      active: true, isGoalkeeper: true, name: '  Bia  ', nickname: '  ',
      preferredPosition: 'goalkeeper' as const, skillRating: 4.5,
    }

    await createPlayer(client, 'group-a', input)
    await updatePlayer(client, 'player-a', input)

    expect(players.insert).toHaveBeenCalledWith(expect.objectContaining({ group_id: 'group-a', name: 'Bia', nickname: null }))
    expect(players.update).toHaveBeenCalledWith({
      active: true,
      is_goalkeeper: true,
      name: 'Bia',
      nickname: null,
      preferred_position: 'goalkeeper',
      skill_rating: 4.5,
    })
    expect(players.eq).toHaveBeenCalledWith('id', 'player-a')
  })
})
