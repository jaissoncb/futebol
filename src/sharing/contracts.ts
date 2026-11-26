export type Disclosure = { groupName: boolean; matchDate: boolean; goalkeepers: boolean }
export type PublicationDays = 7 | 30 | 90
export type PublicationAction = 'publish' | 'renew' | 'replace' | 'revoke'

export type PublicPlayer = { name: string; reserve: boolean; goalkeeper?: boolean }
export type PublicTeam = { name: string; color: string | null; players: PublicPlayer[] }
export type PublicLineup = { groupName?: string; matchDate?: string; teams: PublicTeam[] }
export type PublicDraw = { snapshot: PublicLineup; expiresAt: string }
export type PublishedDraw = PublicDraw & { slug: string }
export type PublicationState = {
  status: 'private' | 'published' | 'expired' | 'revoked'
  version: string | null
  revision: string
  preview: PublicLineup
  options: Disclosure | null
  changed: boolean
  publication: PublishedDraw | null
}
export type PublicationUpdate = {
  action: PublicationAction
  version: string | null
  revision: string
  options: Disclosure
  days: PublicationDays
}

export const isPublicDrawSlug = (slug: string) =>
  /^[a-z0-9][a-z0-9-]{0,39}-[23456789abcdefghijkmnpqrstuvwxyz]{6}$/.test(slug)
