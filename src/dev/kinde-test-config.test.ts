import { describe, expect, it } from 'vitest'
import { assertKindeDevLocation, kindeTestConfig } from './kinde-test-config'
describe('confirmed Futebol Test metadata', () => {
  it('keeps the exact root callback and rejects alternate apps/origins', () => {
    expect(kindeTestConfig.redirectUri).toBe('http://localhost:5173/')
    expect(kindeTestConfig.clientId).toBe('ec7038eb3fba4f958013e0b36437caf1')
    expect(kindeTestConfig.audience).toBe('urn:sabara:futebol:api:dev')
    expect(() => assertKindeDevLocation(new URL('http://localhost:5173/?code=fixture'))).not.toThrow()
    for (const url of ['http://127.0.0.1:5173/', 'http://localhost:5174/', 'https://account.sabara.org/', 'http://localhost:5173/callback']) {
      expect(() => assertKindeDevLocation(new URL(url))).toThrow()
    }
  })
})
