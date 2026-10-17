import type { Pool, PoolClient } from 'pg'
import type { Principal } from './auth.ts'
import { withActor } from './database.ts'
import { HttpError } from './server.ts'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function id(value: string) { if (!uuid.test(value)) throw new HttpError(400, 'invalid_id'); return value }
function object(value: unknown, fields: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'invalid_body')
  const result = value as Record<string, unknown>
  if (Object.keys(result).some(key => !fields.includes(key)) || fields.some(key => !(key in result))) throw new HttpError(400, 'invalid_fields')
  return result
}
function groupBody(body: unknown) {
  const value = object(body, ['name', 'sport', 'defaultPlayersOnCourt'])
  if (typeof value.name !== 'string' || value.name.trim().length < 2 || value.name.trim().length > 80
    || typeof value.sport !== 'string' || value.sport.trim().length < 2 || value.sport.trim().length > 40
    || !Number.isInteger(value.defaultPlayersOnCourt) || Number(value.defaultPlayersOnCourt) < 1
    || Number(value.defaultPlayersOnCourt) > 20) throw new HttpError(400, 'invalid_group')
  return [value.name.trim(), value.defaultPlayersOnCourt, value.sport.trim()]
}
function playerBody(body: unknown) {
  const p = object(body, ['active', 'isGoalkeeper', 'name', 'nickname', 'preferredPosition', 'skillRating'])
  if (typeof p.name !== 'string' || p.name.trim().length < 2 || p.name.trim().length > 80
    || typeof p.active !== 'boolean' || typeof p.isGoalkeeper !== 'boolean'
    || typeof p.skillRating !== 'number' || p.skillRating < 1 || p.skillRating > 5 || p.skillRating * 2 % 1 !== 0
    || (p.nickname !== null && (typeof p.nickname !== 'string' || p.nickname.trim().length > 40))
    || (p.preferredPosition !== null && (typeof p.preferredPosition !== 'string'
      || !['goalkeeper','defense','midfield','attack','any'].includes(p.preferredPosition)))) throw new HttpError(400, 'invalid_player')
  return [p.name.trim(), typeof p.nickname === 'string' ? p.nickname.trim() || null : null,
    p.skillRating, p.isGoalkeeper, p.preferredPosition, p.active]
}
async function changed(client: PoolClient, query: string, values: unknown[]) {
  const result = await client.query(query, values)
  if (result.rowCount !== 1) throw new HttpError(404, 'unavailable')
  return result.rows[0] as unknown
}
export function createDatabaseDispatch(pool: Pool) {
  return async (principal: Principal, method: string, url: URL, body: unknown) => {
    try {
      return await withActor(pool, principal, async (client, actorId) => {
        const path = url.pathname
        if (path === '/me' && ['GET','POST'].includes(method)) {
          if (method === 'POST' && Object.keys(object(body, [])).length) throw new HttpError(400, 'invalid_fields')
          const profile = await client.query('select id, display_name from public.profiles where id=$1', [actorId])
          return profile.rows[0] as unknown
        }
        if (path === '/workspace' && method === 'GET') {
          const groups = await client.query(`select g.*, m.role from public.groups g join public.group_members m
            on m.group_id=g.id and m.user_id=$1 order by g.updated_at desc`, [actorId])
          const players = await client.query<{ player: unknown }>('select to_jsonb(p) as player from public.players p order by active desc, name')
          return { groups: groups.rows, players: players.rows.map(row => row.player) }
        }
        if (path === '/groups' && method === 'POST') {
          const result = await client.query('select public.create_group($1,$2::smallint,$3) as id', groupBody(body))
          return result.rows[0] as unknown
        }
        let match = /^\/groups\/([^/]+)$/.exec(path)
        if (match && method === 'PATCH') return await changed(client, `update public.groups
          set name=$1, default_players_on_court=$2, sport=$3 where id=$4 returning id`, [...groupBody(body), id(match[1])])
        match = /^\/groups\/([^/]+)\/players$/.exec(path)
        if (match && method === 'POST') return await changed(client, `insert into public.players
          (name,nickname,skill_rating,is_goalkeeper,preferred_position,active,group_id)
          values($1,$2,$3,$4,$5,$6,$7) returning id`, [...playerBody(body), id(match[1])])
        match = /^\/players\/([^/]+)$/.exec(path)
        if (match && method === 'PATCH') return await changed(client, `update public.players set
          name=$1,nickname=$2,skill_rating=$3,is_goalkeeper=$4,preferred_position=$5,active=$6 where id=$7 returning id`,
          [...playerBody(body), id(match[1])])
        match = /^\/groups\/([^/]+)\/matches$/.exec(path)
        if (match && method === 'GET') {
          const page = Number(url.searchParams.get('page') ?? '0')
          if (!Number.isInteger(page) || page < 0 || page > 100000) throw new HttpError(400, 'invalid_page')
          return (await client.query<{ match: unknown }>(`select to_jsonb(m) as match from public.matches m where group_id=$1 and status='drawn'
            order by match_date desc, match_time desc nulls last, created_at desc, id desc limit 50 offset $2`,
          [id(match[1]), page * 50])).rows.map(row => row.match)
        }
        match = /^\/groups\/([^/]+)\/matches\/([^/]+)$/.exec(path)
        if (match && method === 'GET') {
          const args = [id(match[1]), id(match[2])]
          // A single SQL snapshot prevents a concurrent group deletion producing a
          // partial graph. JSON preserves date-only strings and numeric DTO fields.
          const saved = await client.query<{ result: unknown }>(`select jsonb_build_object(
            'match',to_jsonb(m),
            'participants',coalesce((select jsonb_agg(to_jsonb(p) order by p.player_name_snapshot) from public.match_players p where p.group_id=m.group_id and p.match_id=m.id),'[]'::jsonb),
            'teams',coalesce((select jsonb_agg(to_jsonb(t) order by t.team_index) from public.teams t where t.group_id=m.group_id and t.match_id=m.id),'[]'::jsonb),
            'assignments',coalesce((select jsonb_agg(to_jsonb(a)) from public.team_assignments a where a.group_id=m.group_id and a.match_id=m.id),'[]'::jsonb),
            'runs',coalesce((select jsonb_agg(to_jsonb(r) order by r.run_number) from public.draw_runs r where r.group_id=m.group_id and r.match_id=m.id),'[]'::jsonb)
          ) as result from public.matches m where m.group_id=$1 and m.id=$2 and m.status='drawn'`, args)
          if (!saved.rowCount) throw new HttpError(404, 'unavailable')
          return saved.rows[0].result
        }
        match = /^\/matches\/([^/]+)\/draw$/.exec(path)
        if (match && method === 'PUT') {
          const result = await client.query('select public.save_match_draw($1,$2::jsonb) as id', [id(match[1]), JSON.stringify(body)])
          return result.rows[0] as unknown
        }
        throw new HttpError(404, 'not_found')
      })
    } catch (error) {
      const code = (error as { code?: string }).code
      if (code === '42501') throw new HttpError(403, 'forbidden')
      if (code === '40001' || code === '23505') throw new HttpError(409, 'conflict')
      if (code?.startsWith('22') || code?.startsWith('23')) throw new HttpError(400, 'invalid_input')
      throw error
    }
  }
}
