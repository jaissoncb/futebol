import { validatePolicy, type TokenPolicy } from './auth.ts'
import { g3Policy, userinfoUrl } from './g3.ts'

export interface RuntimeConfig {
  environment: 'dev' | 'prd'
  allowedOrigin: string
  identity: TokenPolicy & { userinfoUrl: string }
  database: { pooledHost: string; unpooledHost: string; name: string; runtimeRole: string }
}
export interface RuntimeEnvironment {
  FUTEBOL_RUNTIME_CONFIG?: string
  DATABASE_URL?: string
  DATABASE_URL_UNPOOLED?: string
}

function object(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== fields.length
    || fields.some(field => !Object.hasOwn(value, field))) throw new Error()
  return value as Record<string, unknown>
}
function string(value: unknown): string {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > 2048) throw new Error()
  return value
}

// All metadata is operator supplied; there are no request overrides or DEV defaults.
// Both injected DSNs must be replaced, including the unused unpooled connection.
export function readRuntimeConfig(env: RuntimeEnvironment): { config: Readonly<RuntimeConfig>; connectionString: string } {
  try {
    if (!env.FUTEBOL_RUNTIME_CONFIG || env.FUTEBOL_RUNTIME_CONFIG.length > 16384) throw new Error()
    const root = object(JSON.parse(env.FUTEBOL_RUNTIME_CONFIG), ['environment', 'allowedOrigin', 'identity', 'database'])
    const environment = root.environment
    if (environment !== 'dev' && environment !== 'prd') throw new Error()
    const allowedOrigin = string(root.allowedOrigin)
    const origin = new URL(allowedOrigin)
    if (origin.origin !== allowedOrigin || origin.username || origin.password
      || (origin.protocol !== 'https:' && !(environment === 'dev' && allowedOrigin === 'http://localhost:5173'))) throw new Error()

    const identity = object(root.identity, ['issuer', 'audience', 'clientId', 'jwksUri',
      'maxLifetimeSeconds', 'lifetimeRoundingSeconds', 'userinfoUrl'])
    const policy = {
      issuer: string(identity.issuer), audience: string(identity.audience), clientId: string(identity.clientId),
      jwksUri: string(identity.jwksUri), userinfoUrl: string(identity.userinfoUrl),
      maxLifetimeSeconds: identity.maxLifetimeSeconds, lifetimeRoundingSeconds: identity.lifetimeRoundingSeconds,
    }
    // Keep the accepted G3 timing contract; a different PRD contract needs review.
    if (policy.maxLifetimeSeconds !== 600 || policy.lifetimeRoundingSeconds !== 1) throw new Error()
    const tokenPolicy = { ...policy, maxLifetimeSeconds: 600, lifetimeRoundingSeconds: 1 }
    validatePolicy(tokenPolicy)
    const issuer = new URL(policy.issuer)
    if (issuer.origin !== policy.issuer || policy.jwksUri !== `${issuer.origin}/.well-known/jwks`
      || policy.userinfoUrl !== `${issuer.origin}/oauth2/v2/user_profile`) throw new Error()
    if (environment === 'dev') {
      if (Object.entries(g3Policy).some(([key, value]) => identity[key] !== value)
        || policy.userinfoUrl !== userinfoUrl) throw new Error()
    } else if (policy.issuer === g3Policy.issuer || policy.audience === g3Policy.audience
      || policy.clientId === g3Policy.clientId || origin.hostname === 'localhost'
      || origin.hostname === '127.0.0.1' || origin.hostname === '[::1]') throw new Error()

    const db = object(root.database, ['pooledHost', 'unpooledHost', 'name', 'runtimeRole'])
    const database = { pooledHost: string(db.pooledHost), unpooledHost: string(db.unpooledHost),
      name: string(db.name), runtimeRole: string(db.runtimeRole) }
    if (!/^ep-[a-z0-9-]+-pooler\.c-\d+\.eu-central-1\.aws\.neon\.tech$/.test(database.pooledHost)
      || database.unpooledHost !== database.pooledHost.replace('-pooler.', '.')
      || database.name !== `futebol_${environment}`
      || !new RegExp(`^futebol_api_${environment}_[a-z0-9_]{1,40}$`).test(database.runtimeRole)) throw new Error()
    const connection = (input: string | undefined, host: string) => {
      if (!input || input.length > 16384) throw new Error()
      const url = new URL(input)
      const keys = [...url.searchParams.keys()]
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== host
        || url.port && url.port !== '5432' || url.pathname !== `/${database.name}`
        || decodeURIComponent(url.username) !== database.runtimeRole || !url.password || url.hash
        || url.searchParams.get('sslmode') !== 'verify-full'
        || keys.length !== new Set(keys).size
        || keys.some(key => !['sslmode', 'channel_binding'].includes(key))
        || url.searchParams.has('channel_binding') && url.searchParams.get('channel_binding') !== 'require') throw new Error()
      return url
    }
    const pooled = connection(env.DATABASE_URL, database.pooledHost)
    const unpooled = connection(env.DATABASE_URL_UNPOOLED, database.unpooledHost)
    if (decodeURIComponent(pooled.password) !== decodeURIComponent(unpooled.password)) throw new Error()
    return { config: Object.freeze({ environment, allowedOrigin, identity: Object.freeze(tokenPolicy),
      database: Object.freeze(database) }), connectionString: pooled.href }
  } catch {
    // Never attach the parser/pg error: it may contain a DSN or credential.
    throw new Error('invalid_runtime_config')
  }
}
