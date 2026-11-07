import { type FutebolDataClient } from '../lib/data-client'
import type { Database } from '../lib/database.types'

export type Group = Database['public']['Tables']['groups']['Row']
export type Player = Database['public']['Tables']['players']['Row']
export type GroupRole = Database['public']['Enums']['group_role']
export type PreferredPosition = Database['public']['Enums']['preferred_position']

export interface GroupWithRole extends Group {
  role: GroupRole
}

export interface GroupWorkspaceData {
  groups: GroupWithRole[]
  players: Player[]
}

export interface GroupInput {
  name: string
  defaultPlayersOnCourt: number
  sport: string
}

export interface PlayerInput {
  active: boolean
  isGoalkeeper: boolean
  name: string
  nickname: string | null
  preferredPosition: PreferredPosition | null
  skillRating: number
}

export async function loadGroupWorkspace(
  client: FutebolDataClient,
): Promise<GroupWorkspaceData> {
  return client.workspace()
}

export async function createGroup(client: FutebolDataClient, input: GroupInput): Promise<string> {
  return client.createGroup(input)
}

export async function updateGroup(client: FutebolDataClient, groupId: string, input: GroupInput): Promise<void> {
  return client.updateGroup(groupId, input)
}

export async function createPlayer(client: FutebolDataClient, groupId: string, input: PlayerInput): Promise<void> {
  return client.createPlayer(groupId, input)
}

export async function updatePlayer(client: FutebolDataClient, playerId: string, input: PlayerInput): Promise<void> {
  return client.updatePlayer(playerId, input)
}
