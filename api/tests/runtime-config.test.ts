import { test } from 'node:test'
import assert from 'node:assert/strict'
import { g3Policy, userinfoUrl } from '../g3.ts'
import { readRuntimeConfig, type RuntimeConfig, type RuntimeEnvironment } from '../runtime-config.ts'

function fixture(environment: 'dev' | 'prd' = 'dev'): RuntimeConfig {
  return { environment, allowedOrigin: environment === 'dev' ? 'http://localhost:5173' : 'https://futebol.fixture.test',
    identity: environment === 'dev' ? { ...g3Policy, userinfoUrl } : {
      ...g3Policy, issuer: 'https://identity.fixture.test', jwksUri: 'https://identity.fixture.test/.well-known/jwks',
      audience: 'urn:fixture:futebol:prd', clientId: 'fixture-prd-client',
      userinfoUrl: 'https://identity.fixture.test/oauth2/v2/user_profile',
    }, database: { pooledHost: 'ep-fixture-pooler.c-8.eu-central-1.aws.neon.tech',
      unpooledHost: 'ep-fixture.c-8.eu-central-1.aws.neon.tech', name: `futebol_${environment}`,
      runtimeRole: `futebol_api_${environment}_fixture` } }
}
function env(config = fixture()): RuntimeEnvironment {
  const d = config.database
  const dsn = (host: string) => `postgresql://${d.runtimeRole}:synthetic-only@${host}/${d.name}?sslmode=verify-full`
  return { FUTEBOL_RUNTIME_CONFIG: JSON.stringify(config), DATABASE_URL: dsn(d.pooledHost),
    DATABASE_URL_UNPOOLED: dsn(d.unpooledHost) }
}
function denied(environment: RuntimeEnvironment) {
  assert.throws(() => readRuntimeConfig(environment), (error: unknown) => {
    assert.equal(error instanceof Error && error.message, 'invalid_runtime_config')
    assert.equal(error instanceof Error && error.cause, undefined)
    assert.ok(!JSON.stringify(error).includes('synthetic-only'))
    return true
  })
}

void test('runtime requires complete explicit metadata and BOTH overridden restricted URLs; no environment fallback', () => {
  for (const environment of ['dev', 'prd'] as const) {
    const configured = env(fixture(environment))
    const result = readRuntimeConfig(configured)
    assert.equal(result.config.environment, environment)
    assert.equal(result.connectionString, configured.DATABASE_URL)
    assert.ok(Object.isFrozen(result.config.identity))
    for (const key of ['FUTEBOL_RUNTIME_CONFIG', 'DATABASE_URL', 'DATABASE_URL_UNPOOLED'] as const) {
      denied({ ...configured, [key]: undefined })
    }
  }
  denied({ ...env(), FUTEBOL_RUNTIME_CONFIG: '{' })
  denied({ ...env(), FUTEBOL_RUNTIME_CONFIG: '{}' })
})

void test('runtime rejects cross-environment identity, endpoints, origins and altered G3 timing', () => {
  const changes: ((config: RuntimeConfig) => void)[] = [
    c => { c.environment = 'prd' },
    c => { c.allowedOrigin = '*' }, c => { c.allowedOrigin += '/' },
    c => { c.allowedOrigin = 'http://other.test' },
    c => { c.identity.issuer = 'https://other.test' },
    c => { c.identity.userinfoUrl += '?target=other' },
    c => { c.identity.jwksUri = 'https://other.test/jwks' },
    c => { c.identity.audience = 'another-api' }, c => { c.identity.clientId = 'another-client' },
    c => { c.identity.maxLifetimeSeconds = 601 }, c => { c.identity.lifetimeRoundingSeconds = 0 },
    c => { c.database.name = 'futebol_prd' }, c => { c.database.runtimeRole = 'futebol_dev_owner' },
    c => { c.database.unpooledHost = 'ep-other.c-8.eu-central-1.aws.neon.tech' },
  ]
  for (const change of changes) { const config = fixture(); change(config); denied(env(config)) }
  for (const key of ['issuer', 'audience', 'clientId'] as const) {
    const config = fixture('prd'); config.identity[key] = g3Policy[key]; denied(env(config))
  }
  const prd = fixture('prd'); prd.allowedOrigin = 'http://localhost:5173'; denied(env(prd))
})

void test('runtime rejects automatic admin DSNs, mixed login/password/destination, TLS downgrade and query injection', () => {
  const base = env()
  for (const key of ['DATABASE_URL', 'DATABASE_URL_UNPOOLED'] as const) {
    const original = base[key]!
    const variants = [
      original.replace('futebol_api_dev_fixture', 'neondb_owner'),
      original.replace('synthetic-only', 'different-password'),
      original.replace('futebol_dev', 'futebol_prd'),
      original.replace('ep-fixture', 'ep-another'),
      original.replace('verify-full', 'require'),
      original.replace('verify-full', 'no-verify'),
      original + '&sslmode=verify-full', original + '&options=-c%20role%3Dfutebol_owner',
      original + '&sslcert=fixture', original + '&channel_binding=disable', original + '#fragment',
    ]
    for (const value of variants) denied({ ...base, [key]: value })
  }
  const swapped = { ...base, DATABASE_URL: base.DATABASE_URL_UNPOOLED, DATABASE_URL_UNPOOLED: base.DATABASE_URL }
  denied(swapped)
})
