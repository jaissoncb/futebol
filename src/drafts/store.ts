export type DraftEnvironment = 'dev' | 'prd'
export type DraftKind = 'match' | 'player'
export type DraftIssue = 'unavailable' | 'quota' | 'version' | 'corrupt' | 'conflict' | 'revoked'

export class DraftError extends Error {
  constructor(readonly issue: DraftIssue) { super(issue) }
}

export type DraftAccess = {
  environment: DraftEnvironment
  userId: string
  epoch: string
  groups: ReadonlyMap<string, string>
  signal?: AbortSignal
}

export type DraftScope = {
  environment: DraftEnvironment
  userId: string
  groupId: string
  epoch: string
  grant: string
  signal?: AbortSignal
}

type Account = {
  key: [DraftEnvironment]
  userId: string
  epoch: string
  fence: string | null
  groups: Record<string, string>
}
type Key = [DraftEnvironment, string, string, DraftKind]
type Row = { key: Key; schema: number; revision: number; value: unknown }
type Snapshot<T> = { revision: number; value: T | null }

const DATABASE = 'futebol-drafts'
const VERSION = 1
const SCHEMA = 1
const OPEN_TIMEOUT = 2500
const fenceKey = (environment: DraftEnvironment) => `futebol.drafts.logout.${environment}`
export function isDraftLogout(event: StorageEvent, environment: DraftEnvironment) {
  return event.key === fenceKey(environment) && event.newValue !== null
}
export function draftLogoutFence(environment: DraftEnvironment) {
  try { return localStorage.getItem(fenceKey(environment)) } catch { return null }
}

export function draftIssue(error: unknown): DraftIssue {
  if (error instanceof DraftError) return error.issue
  if (error instanceof DOMException && error.name === 'QuotaExceededError') return 'quota'
  if (error instanceof DOMException && error.name === 'VersionError') return 'version'
  return 'unavailable'
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new DraftError('unavailable')); return }
    const request = indexedDB.open(DATABASE, VERSION)
    let expired = false
    const timeout = setTimeout(() => {
      expired = true
      reject(new DraftError('unavailable'))
    }, OPEN_TIMEOUT)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('accounts', { keyPath: 'key' })
      request.result.createObjectStore('drafts', { keyPath: 'key' })
    }
    request.onblocked = () => {
      expired = true
      clearTimeout(timeout)
      reject(new DraftError('version'))
    }
    request.onerror = () => { clearTimeout(timeout); reject(request.error ?? new DraftError('unavailable')) }
    request.onsuccess = () => {
      clearTimeout(timeout)
      const db = request.result
      if (expired) { db.close(); return }
      db.onversionchange = () => db.close()
      resolve(db)
    }
  })
}

// Every decision and write uses one transaction, including authorization and CAS.
async function transaction<T>(mode: IDBTransactionMode, operation: (tx: IDBTransaction, done: (value: T) => void, fail: (reason: unknown) => void) => void): Promise<T> {
  const db = await openDatabase()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(['accounts', 'drafts'], mode, mode === 'readwrite' ? { durability: 'strict' } : undefined)
      let result: T
      let error: Error | undefined
      const fail = (reason: unknown) => { error = reason instanceof Error ? reason : new DraftError('unavailable'); tx.abort() }
      tx.oncomplete = () => resolve(result)
      tx.onabort = () => reject(error ?? tx.error ?? new DraftError('unavailable'))
      try { operation(tx, value => { result = value }, fail) } catch (cause) { fail(cause) }
    })
  } finally { db.close() }
}

function purge(tx: IDBTransaction, environment: DraftEnvironment, keep?: (key: Key) => boolean) {
  const cursor = tx.objectStore('drafts').openCursor(IDBKeyRange.bound([environment], [environment, []]))
  cursor.onsuccess = () => {
    const entry = cursor.result
    if (!entry) return
    if (!keep?.(entry.primaryKey as Key)) entry.delete()
    entry.continue()
  }
}

/** Called only with the profile and workspace verified by the same session lease. */
export function authorizeDrafts(environment: DraftEnvironment, userId: string, allowed: string[], signal: AbortSignal, prior: DraftAccess | null = null) {
  const expectedFence = draftLogoutFence(environment)
  return transaction<DraftAccess>('readwrite', (tx, done, fail) => {
    const accounts = tx.objectStore('accounts')
    const read = accounts.get([environment])
    read.onsuccess = () => {
      if (signal.aborted || draftLogoutFence(environment) !== expectedFence) { fail(new DraftError('revoked')); return }
      const previous = read.result as Account | undefined
      if (previous && (typeof previous.epoch !== 'string' || !previous.groups || typeof previous.groups !== 'object')) {
        fail(new DraftError('corrupt'))
        return
      }
      const same = previous?.userId === userId && previous.fence === expectedFence
      if (prior && (!same || previous.epoch !== prior.epoch)) { fail(new DraftError('revoked')); return }
      if (prior && same && allowed.some(group => prior.groups.has(group) && prior.groups.get(group) !== previous.groups[group])) {
        fail(new DraftError('revoked'))
        return
      }
      const epoch = same ? previous.epoch : crypto.randomUUID()
      const grants = new Map(allowed.map(group => [group,
        (same && Object.hasOwn(previous.groups, group) ? previous.groups[group] : undefined) ?? crypto.randomUUID()]))
      purge(tx, environment, key => same && key[1] === userId && grants.has(key[2]))
      accounts.put({ key: [environment], userId, epoch, fence: expectedFence, groups: Object.fromEntries(grants) } satisfies Account)
      done({ environment, userId, epoch, groups: grants })
    }
  })
}

export function invalidateDrafts(environment: DraftEnvironment) {
  // The opaque fence also invalidates an older database if IndexedDB is temporarily unavailable.
  try { localStorage.setItem(fenceKey(environment), crypto.randomUUID()) } catch { /* IndexedDB still invalidates the account. */ }
  const expectedFence = draftLogoutFence(environment)
  return transaction<void>('readwrite', (tx, done) => {
    if (draftLogoutFence(environment) === expectedFence) {
      tx.objectStore('accounts').delete([environment])
      purge(tx, environment)
    }
    done(undefined)
  })
}

export function draftScope(access: DraftAccess | null | undefined, groupId: string): DraftScope | null {
  const grant = access?.groups.get(groupId)
  return access && grant ? { environment: access.environment, userId: access.userId, epoch: access.epoch, groupId, grant, signal: access.signal } : null
}

function scoped<T>(scope: DraftScope, kind: DraftKind, mode: IDBTransactionMode,
  action: (row: Row | undefined, store: IDBObjectStore, key: Key) => T) {
  const { environment, userId, groupId, epoch, grant, signal } = scope
  const key: Key = [environment, userId, groupId, kind]
  return transaction<T>(mode, (tx, done, fail) => {
    const account = tx.objectStore('accounts').get([environment])
    account.onsuccess = () => {
      const current = account.result as Account | undefined
      if (signal?.aborted || !current || current.userId !== userId || current.epoch !== epoch || current.fence !== draftLogoutFence(environment)
        || current.groups?.[groupId] !== grant) { fail(new DraftError('revoked')); return }
      const store = tx.objectStore('drafts')
      const read = store.get(key)
      read.onsuccess = () => {
        try {
          if (signal?.aborted || current.fence !== draftLogoutFence(environment)) throw new DraftError('revoked')
          done(action(read.result as Row | undefined, store, key))
        } catch (error) { fail(error) }
      }
    }
  })
}

function revision(row: Row | undefined) {
  if (!row) return 0
  if (row.schema !== SCHEMA) throw new DraftError(typeof row.schema === 'number' && row.schema > SCHEMA ? 'version' : 'corrupt')
  if (!Number.isSafeInteger(row.revision) || row.revision < 1 || row.revision >= Number.MAX_SAFE_INTEGER) throw new DraftError('corrupt')
  return row.revision
}

export function readDraft<T>(scope: DraftScope, kind: DraftKind, validate: (value: unknown, groupId: string) => value is T) {
  return scoped<Snapshot<T>>(scope, kind, 'readonly', row => {
    const current = revision(row)
    if (!row || row.value === null) return { revision: current, value: null }
    if (!validate(row.value, scope.groupId)) throw new DraftError('corrupt')
    return { revision: current, value: row.value }
  })
}

export function writeDraft<T>(scope: DraftScope, kind: DraftKind, expected: number, value: T | null) {
  return scoped(scope, kind, 'readwrite', (row, store, key) => {
    const current = revision(row)
    if (current !== expected) throw new DraftError('conflict')
    // Keep an empty revision so an older tab cannot recreate a discarded draft.
    store.put({ key, schema: SCHEMA, revision: current + 1, value } satisfies Row)
    return current + 1
  })
}

export function discardCorruptDraft<T>(scope: DraftScope, kind: DraftKind, validate: (value: unknown, groupId: string) => value is T) {
  return scoped(scope, kind, 'readwrite', (row, store, key) => {
    if (!row || (typeof row.schema === 'number' && row.schema > SCHEMA)) throw new DraftError('conflict')
    let current: number
    let validEnvelope = true
    try {
      current = revision(row)
    } catch {
      // A fresh revision prevents a stale tab from matching an invalid envelope by accident.
      current = Date.now()
      validEnvelope = false
    }
    if (validEnvelope && (row.value === null || validate(row.value, scope.groupId))) throw new DraftError('conflict')
    store.put({ key, schema: SCHEMA, revision: current + 1, value: null } satisfies Row)
  })
}
