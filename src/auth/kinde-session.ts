import { LocalStorage, MemoryStorage, setInsecureStorage, storageSettings, StorageKeys } from '@kinde-oss/kinde-auth-react/utils'

export const KINDE_SCOPE = 'openid profile email offline'
export const FUTEBOL_STORAGE_PREFIX = 'futebol-kinde-test-'
const TRANSACTION_TTL_MS = 10 * 60 * 1000
const transactionKeys = [StorageKeys.state, StorageKeys.nonce, StorageKeys.codeVerifier]
const tokenKeys = [StorageKeys.accessToken, StorageKeys.idToken, StorageKeys.refreshToken]

// Adapted from Account's reviewed architecture. SDK still owns state/nonce/S256
// generation and validation; no tokens are ever read from persistent storage.
export class OAuthTransactionStorage extends LocalStorage {
  private tokens: MemoryStorage
  private timestampKey: string
  constructor(tokens: MemoryStorage, prefix = FUTEBOL_STORAGE_PREFIX) {
    super(); this.tokens = tokens; this.timestampKey = `${prefix}transaction-created`
  }
  override setSessionItem(key: StorageKeys, value: unknown) {
    if (tokenKeys.includes(key)) { this.tokens.setSessionItem(key, value); return }
    if (key === StorageKeys.state) localStorage.setItem(this.timestampKey, String(Date.now()))
    super.setSessionItem(key, value)
  }
  override getSessionItem(key: StorageKeys) {
    if (tokenKeys.includes(key)) return this.tokens.getSessionItem(key)
    const created = Number(localStorage.getItem(this.timestampKey))
    if (!created || created > Date.now() || Date.now() - created > TRANSACTION_TTL_MS) {
      this.clearTransaction()
      return null
    }
    return super.getSessionItem(key)
  }
  override removeSessionItem(key: StorageKeys) {
    if (tokenKeys.includes(key)) this.tokens.removeSessionItem(key)
    else super.removeSessionItem(key)
  }
  clearTransaction() {
    for (const key of transactionKeys) super.removeSessionItem(key)
    localStorage.removeItem(this.timestampKey)
  }
  override destroySession() {
    this.clearTransaction()
    for (const key of tokenKeys) super.removeSessionItem(key) // only old Futebol namespace, never Account
    this.tokens.destroySession()
  }
}

export function configureKindeSession(environment: 'dev' | 'prd' = 'dev') {
  // Call after the React SDK import (which initializes its default prefix).
  // Account/Futebol must also use different browser profiles and exclusive port 5173.
  const prefix = environment === 'dev' ? FUTEBOL_STORAGE_PREFIX : 'futebol-kinde-prd-'
  storageSettings.keyPrefix = prefix
  storageSettings.useInsecureForRefreshToken = false
  const memory = new MemoryStorage()
  const transaction = new OAuthTransactionStorage(memory, prefix)
  setInsecureStorage(transaction)
  return { memory, transaction }
}
