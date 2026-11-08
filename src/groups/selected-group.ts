const KEY = 'futebol.selected-group.v1'

/** Only an opaque preference; membership must always come from the authenticated API. */
export function readSelectedGroup(userId: string): string | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? 'null')
    if (typeof value === 'object' && value !== null && 'userId' in value && value.userId === userId
      && 'groupId' in value && typeof value.groupId === 'string') return value.groupId
    clearSelectedGroup()
  } catch { clearSelectedGroup() }
  return null
}

export function rememberSelectedGroup(userId: string, groupId: string | null): void {
  try {
    if (groupId) sessionStorage.setItem(KEY, JSON.stringify({ userId, groupId }))
    else clearSelectedGroup()
  } catch { /* Storage can be unavailable; selection still works in memory. */ }
}

export function clearSelectedGroup(): void {
  try { sessionStorage.removeItem(KEY) } catch { /* No storage permission. */ }
}
