import { clearRefreshTimer, isCustomDomain, refreshToken, RefreshType, StorageKeys } from '@kinde-oss/kinde-auth-react/utils'
import { decodeJwt } from 'jose'
import type { configureKindeSession } from '../auth/kinde-session'
import type { FutebolFrontendConfiguration } from '../config/futebol-environment'
import type { GroupWorkspaceData } from '../groups/group-service'
import { ApiError } from '../lib/api/client'
import { authorizeDrafts, draftIssue, draftLogoutFence, invalidateDrafts, type DraftAccess, type DraftIssue } from '../drafts/store'
import { createFutebolApiServices, type FutebolApiServices } from '../lib/api/services'
import { clearWorkspaceScroll } from './workspace-scroll'
import { clearSelectedGroup } from '../groups/selected-group'

type Session = ReturnType<typeof configureKindeSession>
type Phase = 'opening' | 'anonymous' | 'ready' | 'recovering' | 'unavailable' | 'denied' | 'reauthenticate' | 'ended'
export type Workspace = { services: FutebolApiServices; internalId: string; data: GroupWorkspaceData; drafts?: DraftAccess | null; draftIssue?: DraftIssue }
export type WorkspaceAccess = 'active' | 'readonly' | 'blocked'
type Snapshot = { phase: Phase; workspace: Workspace | null; access: WorkspaceAccess; retainedLayout: boolean }
type Renewal = 'transport' | 'missing' | 'unknown'
const RENEW_EARLY_MS = 10_000
const RETRY_DELAY_MS = 2_000
const MAX_ATTEMPTS = 2

function expiresAt(token: string | null) {
  if (!token) return 0
  try {
    const { exp } = decodeJwt(token)
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : 0
  } catch { return 0 }
}

// React SDK 5.13.1 collapses all non-2xx token responses to the same error.
// Recognize only its known browser transport errors. Ambiguous results require user action.
function renewalFailure(error?: string): Renewal {
  if (error === 'No refresh token found') return 'missing'
  return /^No access token received: TypeError: (Failed to fetch|NetworkError when attempting to fetch resource\.?|Load failed)$/.test(error ?? '')
    ? 'transport' : 'unknown'
}

export function createFutebolSession(config: FutebolFrontendConfiguration, session: Session, initialFailed: boolean) {
  let snapshot: Snapshot = { phase: initialFailed ? 'ended' : 'opening', workspace: null, access: 'blocked', retainedLayout: false }
  let stopped = initialFailed
  let initialized = false
  let sdkAuthenticated = false
  let sdkSubject: string | undefined
  let coldFailure: Renewal | undefined
  let checkedToken: string | null = null
  let verifiedProfileId: string | undefined
  let renewedToken: string | null = null
  let probe: FutebolApiServices | undefined
  let draftLease: AbortController | undefined
  let draftSession = new AbortController()
  let draftAccess: DraftAccess | null = null
  let running = false
  let queued = false
  let revision = 0
  let attempts = 0
  let needsRefresh = false
  const deniedPaths = new Set<string>()
  let offline = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let expiry: ReturnType<typeof setTimeout> | undefined
  let watchdog: ReturnType<typeof setTimeout> | undefined
  let mounts = 0
  const listeners = new Set<() => void>()
  const logoutFence = draftLogoutFence(config.environment)

  const token = () => session.memory.getSessionItem(StorageKeys.accessToken) as string | null
  const online = () => !offline && navigator.onLine !== false
  const log = (event: string) => {
    if (config.environment === 'dev') console.info('futebol_session', event)
  }
  const publish = (phase: Phase, workspace = snapshot.workspace, access: WorkspaceAccess = phase === 'ready' ? 'active' : 'blocked') => {
    if (snapshot.phase === phase && workspace === snapshot.workspace && access === snapshot.access) return
    if (snapshot.phase !== phase) log(phase)
    snapshot = { phase, workspace, access, retainedLayout: phase !== 'ended' && (workspace !== null || snapshot.retainedLayout) }
    for (const listener of listeners) listener()
  }
  const suspend = () => {
    clearTimeout(timer)
    services.suspend()
  }
  const waiting = (phase: Phase) => {
    clearTimeout(expiry)
    const remaining = expiresAt(checkedToken) - Date.now()
    const access = token()
    if (snapshot.workspace && remaining > 0 && (access === checkedToken || access === renewedToken)) {
      publish(phase, snapshot.workspace, 'readonly')
      expiry = setTimeout(() => publish(snapshot.phase, snapshot.workspace, 'blocked'), remaining)
    } else publish(phase, snapshot.workspace, 'blocked')
  }
  const invalidate = () => {
    revision++
    suspend()
    probe?.close()
    draftLease?.abort()
  }
  const end = () => {
    if (stopped) return
    stopped = true
    if (verifiedProfileId) clearWorkspaceScroll()
    verifiedProfileId = undefined
    draftSession.abort()
    invalidate()
    clearTimeout(watchdog)
    clearTimeout(expiry)
    services.close()
    session.memory.end()
    publish('ended', null)
    try { session.transaction.destroySession() } catch { /* Private access is already closed if storage is unavailable. */ }
  }
  const loggedOutElsewhere = () => {
    if (draftLogoutFence(config.environment) === logoutFence) return false
    clearSelectedGroup()
    clearWorkspaceScroll()
    end()
    return true
  }

  function onPrivateFailure(error: ApiError, path: string) {
    if (snapshot.access !== 'active') return
    if (error.status === 401) {
      needsRefresh = true
      requestCheck(true)
    } else if (error.status === 403 && !deniedPaths.has(path)) {
      // The resource operation fails normally. Recheck membership/roles before showing cached data.
      deniedPaths.add(path)
      log('resource_denied')
      requestCheck(true)
    } else if (error.kind === 'transport' || error.status === 503) {
      // Timeouts/transport errors can leave a write's outcome unknown. Never replay it.
      requestCheck()
    }
  }

  const services = createFutebolApiServices(config.apiBaseUrl, () => {
    if (loggedOutElsewhere()) return Promise.resolve(null)
    const current = token()
    if (snapshot.access === 'active' && current === checkedToken && expiresAt(current) > Date.now() + RENEW_EARLY_MS && online()) return Promise.resolve(current)
    if (snapshot.access === 'active') {
      if (expiresAt(current) <= Date.now() + RENEW_EARLY_MS) needsRefresh = true
      requestCheck(current !== checkedToken)
    }
    return Promise.resolve(null)
  }, undefined, onPrivateFailure)
  services.suspend()

  function retry() {
    if (!online()) { waiting('unavailable'); return }
    if (attempts < MAX_ATTEMPTS) {
      waiting(snapshot.access === 'readonly' ? 'ready' : 'recovering')
      timer = setTimeout(() => requestCheck(), RETRY_DELAY_MS)
    } else waiting('unavailable')
  }

  async function renew() {
    const { domain, clientId } = config.identity
    const useCookie = isCustomDomain(domain) && !session.memory.getSessionItem(StorageKeys.refreshToken)
    const exchange = () => refreshToken({ domain, clientId, refreshType: useCookie ? RefreshType.cookie : RefreshType.refreshToken })
    // On browsers with Web Locks, serialize app-owned exchanges across Futebol tabs on this origin.
    return navigator.locks ? navigator.locks.request(`futebol-${config.environment}-refresh`, () =>
      stopped || !online() ? null : exchange()) : exchange()
  }

  async function check() {
    if (running || stopped || !initialized || !online()) return
    running = true
    const started = revision
    const current = () => !stopped && started === revision && online()
    attempts++
    watchdog = setTimeout(() => { if (current()) waiting('unavailable') }, 20_000)
    try {
      let access = token()
      if (needsRefresh || expiresAt(access) <= Date.now() + RENEW_EARLY_MS) {
        needsRefresh = true
        clearRefreshTimer()
        const result = await renew()
        clearRefreshTimer() // The SDK arms its own timer after a successful exchange.
        if (stopped) return
        if (!result) return
        if (!result.success) {
          const failure = renewalFailure(result.error)
          log(failure === 'transport' ? 'refresh_transport' : failure === 'missing' ? 'refresh_missing' : 'refresh_unclassified')
          if (failure === 'missing') end()
          else if (failure === 'unknown' && current()) { clearTimeout(expiry); publish('reauthenticate') }
          else if (current()) retry()
          return
        }
        needsRefresh = false
        renewedToken = token()
        if (!current()) return
        access = renewedToken
      }
      if (!access || expiresAt(access) <= Date.now()) { end(); return }
      const verifyingToken = access
      const verifier = createFutebolApiServices(config.apiBaseUrl, () => Promise.resolve(
        current() && token() === verifyingToken && expiresAt(verifyingToken) > Date.now() ? verifyingToken : null))
      probe = verifier
      const profile = await verifier.me()
      if (!current()) return
      if (verifiedProfileId && profile.id !== verifiedProfileId) { end(); void invalidateDrafts(config.environment).catch(() => undefined); return }
      const data = await verifier.workspace()
      if (!current()) return
      if (token() !== access || expiresAt(access) <= Date.now() + RENEW_EARLY_MS) {
        needsRefresh = expiresAt(token()) <= Date.now() + RENEW_EARLY_MS
        retry()
        return
      }
      draftLease = new AbortController()
      let storageIssue: DraftIssue | undefined
      const allowed = data.groups.filter(group => group.role === 'owner' || group.role === 'admin').map(group => group.id)
      try {
        draftAccess = await authorizeDrafts(config.environment, profile.id, allowed, draftLease.signal, draftAccess)
      } catch (error) {
        storageIssue = draftIssue(error)
        if (storageIssue === 'revoked' && current()) { end(); return }
        if (draftAccess) {
          const stillAllowed = new Set(allowed)
          draftAccess = { ...draftAccess, groups: new Map([...draftAccess.groups].filter(([group]) => stillAllowed.has(group))) }
        }
      }
      if (!current()) return
      if (token() !== access || expiresAt(access) <= Date.now() + RENEW_EARLY_MS) {
        needsRefresh = expiresAt(token()) <= Date.now() + RENEW_EARLY_MS
        retry()
        return
      }
      checkedToken = access
      verifiedProfileId = profile.id
      renewedToken = null
      clearTimeout(expiry)
      services.resume()
      attempts = 0
      publish('ready', { services, internalId: profile.id, data,
        drafts: draftAccess && { ...draftAccess, signal: draftSession.signal }, draftIssue: storageIssue })
      timer = setTimeout(() => requestCheck(token() !== checkedToken),
        Math.max(1, expiresAt(access) - Date.now() - RENEW_EARLY_MS))
    } catch (error) {
      if (!current()) return
      if (error instanceof ApiError && error.kind === 'http' && error.status === 401) {
        checkedToken = null
        if (renewedToken && renewedToken === token()) end()
        else { needsRefresh = true; retry() }
      } else if (error instanceof ApiError && error.kind === 'http' && error.status === 403) {
        // A status alone does not prove revocation. Revoke this tab's lease,
        // then require both identity and membership before reopening storage.
        checkedToken = null
        clearTimeout(expiry)
        draftSession.abort()
        draftSession = new AbortController()
        publish('denied', null)
      } else {
        retry()
      }
    } finally {
      clearTimeout(watchdog)
      probe?.close()
      probe = undefined
      running = false
      if (queued) { queued = false; requestCheck() }
    }
  }

  function requestCheck(protect = false) {
    if (stopped || !initialized || snapshot.phase === 'anonymous' || snapshot.phase === 'reauthenticate' || loggedOutElsewhere()) return
    if (protect) checkedToken = null
    if (!online()) { invalidate(); waiting('unavailable'); return }
    if (running) return
    suspend()
    waiting(snapshot.workspace && expiresAt(checkedToken) > Date.now() ? 'ready' : 'recovering')
    void check()
  }

  function checkOnReturn() {
    if (stopped || loggedOutElsewhere()) return
    const access = token()
    if (snapshot.access === 'active') {
      deniedPaths.clear()
      if (access !== checkedToken || expiresAt(access) - Date.now() <= RENEW_EARLY_MS || !online()) {
        requestCheck(access !== checkedToken)
      }
      return
    }
    if (snapshot.access === 'readonly' && (expiresAt(checkedToken) <= Date.now()
      || (access !== checkedToken && access !== renewedToken))) waiting(snapshot.phase)
    if (snapshot.phase === 'unavailable' && attempts < MAX_ATTEMPTS && online()) requestCheck()
  }

  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    snapshot: () => snapshot,
    syncAuth(authenticated: boolean, loading: boolean, subject?: string) {
      if (loading) return
      clearRefreshTimer()
      if (stopped) return
      if (sdkAuthenticated && (!authenticated || (sdkSubject && subject && sdkSubject !== subject))) {
        if (authenticated) void invalidateDrafts(config.environment).catch(() => undefined)
        end()
        return
      }
      sdkAuthenticated = authenticated
      if (subject) sdkSubject = subject
      if (!initialized) {
        initialized = true
        if (authenticated) requestCheck()
        else if (coldFailure === 'transport') { needsRefresh = true; requestCheck() }
        else publish(coldFailure === 'unknown' ? 'reauthenticate' : 'anonymous')
      }
    },
    startupFailure(failure: string) { if (!initialized) coldFailure = renewalFailure(failure) },
    sdkSuccess() { clearRefreshTimer() },
    end,
    offline: () => {
      offline = true
      if (stopped || !initialized || snapshot.phase === 'anonymous' || snapshot.phase === 'reauthenticate') return
      invalidate()
      waiting('unavailable')
    },
    online: () => {
      const returned = offline
      offline = false
      if (snapshot.phase !== 'unavailable' && snapshot.phase !== 'recovering' && snapshot.phase !== 'ready') return
      if (!returned && snapshot.access === 'active') return
      if (!returned && attempts >= MAX_ATTEMPTS) return
      if (returned) attempts = 0
      if (running && returned) queued = true
      else requestCheck()
    },
    foreground: checkOnReturn,
    groupsChanged: () => requestCheck(),
    retry: () => {
      if (running || !online()) return
      attempts = 0
      requestCheck()
    },
    mount() {
      mounts++
      return () => {
        mounts--
        queueMicrotask(() => {
          if (mounts) return
          end()
        })
      }
    },
  }
}
