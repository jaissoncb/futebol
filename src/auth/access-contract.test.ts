import { describe, expect, it } from 'vitest'
import { accessContract } from './access-contract'

describe('sanitized access rejection codes', () => {
  it('reports only contract names, never the bearer or claim values', () => {
    const identity = { domain: 'https://login.sabara.org', audience: 'urn:sabara:futebol:api:prd', clientId: 'expected-client', redirectUri: '', logoutUri: '' }
    const iat = Math.floor(Date.now() / 1000)
    const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
    const token = `${encode({ alg: 'RS256', kid: 'test' })}.${encode({ iss: identity.domain, aud: identity.audience, azp: 'private-value', sub: 'private-subject', iat, exp: iat + 600 })}.test`
    expect(accessContract(token, identity)).toEqual(['client', 'password_method', 'authentication_time'])
    expect(accessContract(null, identity)).toEqual(['token_missing'])
    expect(accessContract('invalid', identity)).toEqual(['token_format'])
  })
})
