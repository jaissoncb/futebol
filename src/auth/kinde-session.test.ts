import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@kinde-oss/kinde-auth-react'
import { MemoryStorage, StorageKeys } from '@kinde-oss/kinde-auth-react/utils'
import { configureKindeSession, FUTEBOL_STORAGE_PREFIX, OAuthTransactionStorage } from './kinde-session'

describe('Futebol OAuthTransactionStorage with real official SDK storage classes', () => {
  beforeEach(() => { localStorage.clear(); configureKindeSession() })
  afterEach(() => { localStorage.clear(); vi.useRealTimers() })
  it('routes all three token types only to memory and ignores old persistent tokens', () => {
    const { memory, transaction } = configureKindeSession()
    for (const key of [StorageKeys.accessToken, StorageKeys.idToken, StorageKeys.refreshToken]) {
      localStorage.setItem(`${FUTEBOL_STORAGE_PREFIX}${key}0`, 'old-fixture-token')
      expect(transaction.getSessionItem(key)).toBeNull()
      localStorage.removeItem(`${FUTEBOL_STORAGE_PREFIX}${key}0`)
      transaction.setSessionItem(key, 'memory-fixture-token')
      expect(transaction.getSessionItem(key)).toBe('memory-fixture-token')
      expect(memory.getSessionItem(key)).toBe('memory-fixture-token')
    }
    expect(localStorage.length).toBe(0)
  })
  it('restores only the redirect transaction on reload, with no restored token', () => {
    const { transaction } = configureKindeSession()
    for (const key of [StorageKeys.state, StorageKeys.nonce, StorageKeys.codeVerifier]) transaction.setSessionItem(key, `fixture-${key}`)
    transaction.setSessionItem(StorageKeys.refreshToken, 'memory-only-fixture')
    const reload = new OAuthTransactionStorage(new MemoryStorage())
    expect(reload.getSessionItem(StorageKeys.state)).toBe('fixture-state')
    expect(reload.getSessionItem(StorageKeys.codeVerifier)).toBe('fixture-codeVerifier')
    expect(reload.getSessionItem(StorageKeys.refreshToken)).toBeNull()
  })
  it('expires a transaction and removes it even in a newly loaded adapter', () => {
    const { transaction } = configureKindeSession()
    transaction.setSessionItem(StorageKeys.state, 'fixture-state')
    transaction.setSessionItem(StorageKeys.codeVerifier, 'fixture-verifier')
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 11 * 60 * 1000)
    expect(new OAuthTransactionStorage(new MemoryStorage()).getSessionItem(StorageKeys.state)).toBeNull()
    expect(localStorage.length).toBe(0)
  })
  it('logout clears only Futebol tokens/transaction and leaves Account keys intact', () => {
    localStorage.setItem('state0', 'account-fixture-state')
    localStorage.setItem('refreshToken0', 'account-fixture-token')
    const { transaction } = configureKindeSession()
    transaction.setSessionItem(StorageKeys.state, 'futebol-fixture-state')
    transaction.setSessionItem(StorageKeys.refreshToken, 'futebol-memory-only')
    const reload = new OAuthTransactionStorage(new MemoryStorage())
    reload.destroySession(); transaction.destroySession()
    expect(localStorage.length).toBe(2)
    expect(localStorage.getItem('state0')).toBe('account-fixture-state')
    expect(localStorage.getItem('refreshToken0')).toBe('account-fixture-token')
    expect(transaction.getSessionItem(StorageKeys.refreshToken)).toBeNull()
  })
})
