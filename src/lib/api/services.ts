import { ApiError, createApiClient } from './client'
import type { GroupInput, GroupWorkspaceData, PlayerInput } from '../../groups/group-service'
import type { Tables } from '../supabase/database.types'
import type { SaveDrawPayload } from '../../matches/draw-payload'
import { validateSavedMatch, type SavedMatch } from '../../matches/match-service'

function id(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new ApiError(400)
  return value
}
export function createFutebolApiServices(getAccessToken: () => Promise<string | null>, transport = fetch) {
  const client = createApiClient('http://localhost:8787', getAccessToken, transport)
  return {
    kind: 'futebol-api' as const,
    isClosed: client.isClosed,
    subscribeClosed: client.subscribeClosed,
    close: () => client.close(),
    async me() {
      const profile = await client.request<{ id: string; display_name: string | null }>('/me')
      id(profile.id)
      return profile
    },
    workspace: () => client.request<GroupWorkspaceData>('/workspace'),
    stabilizationRead: () => client.request<GroupWorkspaceData>('/workspace?__dev_delay=1'),
    async createGroup(input: GroupInput) {
      const response = await client.request<{ id: string }>('/groups', 'POST', input)
      return id(response.id)
    },
    async updateGroup(groupId: string, input: GroupInput) {
      await client.request(`/groups/${id(groupId)}`, 'PATCH', input)
    },
    async createPlayer(groupId: string, input: PlayerInput) {
      await client.request(`/groups/${id(groupId)}/players`, 'POST', input)
    },
    async updatePlayer(playerId: string, input: PlayerInput) {
      await client.request(`/players/${id(playerId)}`, 'PATCH', input)
    },
    async history(groupId: string, page = 0) {
      if (!Number.isInteger(page) || page < 0 || page > 100000) throw new ApiError(400)
      return client.request<Tables<'matches'>[]>(`/groups/${id(groupId)}/matches?page=${page}`)
    },
    async savedMatch(groupId: string, matchId: string): Promise<SavedMatch> {
      const saved = await client.request<SavedMatch>(`/groups/${id(groupId)}/matches/${id(matchId)}`)
      return validateSavedMatch(saved)
    },
    async saveDraw(matchId: string, payload: SaveDrawPayload) {
      const response = await client.request<{ id: string }>(`/matches/${id(matchId)}/draw`, 'PUT', payload)
      if (response.id !== matchId) throw new Error('Resposta de salvamento inválida.')
      return matchId
    },
  }
}
export type FutebolApiServices = ReturnType<typeof createFutebolApiServices>
