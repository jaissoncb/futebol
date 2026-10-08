import type { FutebolSupabaseClient } from '../lib/supabase/client'
import type { Database } from '../lib/supabase/database.types'

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
  client: FutebolSupabaseClient,
  userId: string,
): Promise<GroupWorkspaceData> {
  const [groupsResult, membershipsResult, playersResult] = await Promise.all([
    client.from('groups').select('*').order('updated_at', { ascending: false }),
    client.from('group_members').select('group_id, role').eq('user_id', userId),
    client.from('players').select('*').order('active', { ascending: false }).order('name'),
  ])

  const error = groupsResult.error ?? membershipsResult.error ?? playersResult.error
  if (error) throw error

  const roles = new Map((membershipsResult.data ?? []).map((membership) => [membership.group_id, membership.role]))
  const groups = (groupsResult.data ?? []).flatMap((group) => {
    const role = roles.get(group.id)
    return role ? [{ ...group, role }] : []
  })

  return { groups, players: playersResult.data ?? [] }
}

export async function createGroup(client: FutebolSupabaseClient, input: GroupInput): Promise<string> {
  const { data, error } = await client.rpc('create_group', {
    default_players_on_court: input.defaultPlayersOnCourt,
    group_name: input.name.trim(),
    sport: input.sport.trim(),
  })

  if (error) throw error
  return data
}

export async function updateGroup(
  client: FutebolSupabaseClient,
  groupId: string,
  input: GroupInput,
): Promise<void> {
  const { error } = await client
    .from('groups')
    .update({
      default_players_on_court: input.defaultPlayersOnCourt,
      name: input.name.trim(),
      sport: input.sport.trim(),
    })
    .eq('id', groupId)
    .select('id')
    .single()

  if (error) throw error
}

export async function createPlayer(
  client: FutebolSupabaseClient,
  groupId: string,
  input: PlayerInput,
): Promise<void> {
  const { error } = await client.from('players').insert({
    active: input.active,
    group_id: groupId,
    is_goalkeeper: input.isGoalkeeper,
    name: input.name.trim(),
    nickname: normalizeOptionalText(input.nickname),
    preferred_position: input.preferredPosition,
    skill_rating: input.skillRating,
  })

  if (error) throw error
}

export async function updatePlayer(
  client: FutebolSupabaseClient,
  playerId: string,
  input: PlayerInput,
): Promise<void> {
  const { error } = await client
    .from('players')
    .update({
      active: input.active,
      is_goalkeeper: input.isGoalkeeper,
      name: input.name.trim(),
      nickname: normalizeOptionalText(input.nickname),
      preferred_position: input.preferredPosition,
      skill_rating: input.skillRating,
    })
    .eq('id', playerId)
    .select('id')
    .single()

  if (error) throw error
}

function normalizeOptionalText(value: string | null): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}
