import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@kinde-oss/kinde-auth-react'
import { base64UrlDecode, clearRefreshTimer, exchangeAuthCode, setActiveStorage, StorageKeys } from '@kinde-oss/kinde-auth-react/utils'
import { configureKindeSession } from './kinde-session'
import { kindeTestConfig } from '../dev/kinde-test-config'
import { createFutebolAuthorization } from './kinde-authorization'

describe('official SDK PKCE with synthetic HTTP fixtures only', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('crypto', webcrypto)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => { clearRefreshTimer(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
  const begin = async () => {
    const url = await createFutebolAuthorization('#/conta')
    return { url, state: url.searchParams.get('state')!, nonce: url.searchParams.get('nonce')!,
      codeChallenge: url.searchParams.get('code_challenge')! }
  }
  it('generates S256, unpredictable state/nonce and the exact public-client root redirect', async () => {
    const { transaction } = configureKindeSession()
    const result = await begin()
    const verifier = transaction.getSessionItem(StorageKeys.codeVerifier) as string
    const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
    const expected = Buffer.from(digest).toString('base64url')
    expect(result.codeChallenge).toBe(expected)
    expect(result.url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(result.url.searchParams.get('redirect_uri')).toBe('http://localhost:5173/')
    expect(result.url.searchParams.get('client_id')).toBe(kindeTestConfig.clientId)
    expect(result.url.searchParams.get('audience')).toBe(kindeTestConfig.audience)
    expect(result.state.length).toBeGreaterThanOrEqual(32)
    expect(JSON.parse(base64UrlDecode(result.state)) as unknown).toMatchObject({ returnHash: '#/conta' })
    expect(result.nonce.length).toBeGreaterThanOrEqual(16)
    expect(transaction.getSessionItem(StorageKeys.state)).toBe(result.state)
    expect((await begin()).state).not.toBe(result.state)
  })
  it('rejects mismatched state and missing verifier before any token HTTP request', async () => {
    const { memory, transaction } = configureKindeSession(); setActiveStorage(memory)
    const request = vi.fn<typeof fetch>(); vi.stubGlobal('fetch', request)
    const result = await begin()
    const args = { domain: kindeTestConfig.domain, clientId: kindeTestConfig.clientId, redirectURL: kindeTestConfig.redirectUri }
    expect((await exchangeAuthCode({ ...args, urlParams: new URLSearchParams({ code: 'synthetic-code', state: 'wrong-synthetic-state' }) })).success).toBe(false)
    transaction.removeSessionItem(StorageKeys.codeVerifier)
    expect((await exchangeAuthCode({ ...args, urlParams: new URLSearchParams({ code: 'synthetic-code', state: result.state }) })).success).toBe(false)
    expect(request).not.toHaveBeenCalled()
  })
  it('exchanges without secret, stores fixture tokens only in memory and rejects callback replay', async () => {
    const { memory, transaction: store } = configureKindeSession(); setActiveStorage(memory)
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'synthetic-access', id_token: 'synthetic-id', refresh_token: 'synthetic-refresh', expires_in: 600,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', request)
    const transaction = await begin()
    const verifier = store.getSessionItem(StorageKeys.codeVerifier)
    const args = { domain: kindeTestConfig.domain, clientId: kindeTestConfig.clientId, redirectURL: kindeTestConfig.redirectUri,
      urlParams: new URLSearchParams({ code: 'synthetic-code', state: transaction.state }) }
    expect((await exchangeAuthCode(args)).success).toBe(true)
    const body = request.mock.calls[0]![1]?.body as URLSearchParams
    expect(body.get('client_secret')).toBeNull()
    expect(body.get('code_verifier')).toBe(verifier)
    expect(body.get('redirect_uri')).toBe(kindeTestConfig.redirectUri)
    expect(memory.getSessionItem(StorageKeys.refreshToken)).toBe('synthetic-refresh')
    const persistent = Object.keys(localStorage).map(key => localStorage.getItem(key)).join(' ')
    expect(persistent).not.toContain('synthetic-access')
    expect(persistent).not.toContain('synthetic-id')
    expect(persistent).not.toContain('synthetic-refresh')
    expect((await exchangeAuthCode(args)).success).toBe(false)
    expect(request).toHaveBeenCalledOnce()
  })
})
