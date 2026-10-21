import { describe, expect, it } from 'vitest'
import dev from '../../deployment/frontend-dev.json'
import prd from '../../deployment/frontend-prd.json'
import { assertFutebolLocation, validateFutebolEnvironment } from './futebol-environment'

describe('explicit public Futebol environments', () => {
  it('pins DEV to the existing Kinde Test and deployed Function with the exact callback origin', () => {
    expect(validateFutebolEnvironment(dev, 'dev')).toEqual(dev)
    for (const patch of [{ apiBaseUrl: 'http://localhost:8787' }, { appOrigin: 'http://127.0.0.1:5173' },
      { apiBaseUrl: `${dev.apiBaseUrl}/?redirect=bad` }, { environment: 'prd' }, { secret: 'SYNTHETIC_ONLY' }]) {
      expect(() => validateFutebolEnvironment({ ...dev, ...patch }, 'dev')).toThrow('Configuração pública Futebol DEV inválida')
    }
  })
  it('blocks the incomplete PRD contract and every reused Test identifier without revealing values', () => {
    expect(() => validateFutebolEnvironment(prd, 'prd')).toThrow('PRD bloqueado')
    expect(() => validateFutebolEnvironment(dev, 'prd')).toThrow('PRD bloqueado')
    // Synthetic complete PRD metadata tests the boundary, not an approved contract.
    const synthetic = { environment: 'prd', appOrigin: 'https://futebol.sabara.org', apiBaseUrl: 'https://api.futebol.sabara.org',
      identity: { domain: 'https://synthetic-prd.eu.kinde.com', clientId: 'synthetic-prd-client', audience: 'urn:synthetic:futebol:prd',
        redirectUri: 'https://futebol.sabara.org/', logoutUri: 'https://futebol.sabara.org/' } }
    expect(validateFutebolEnvironment(synthetic, 'prd')).toEqual(synthetic)
    for (const field of ['domain', 'clientId', 'audience'] as const) {
      expect(() => validateFutebolEnvironment({ ...synthetic, identity: { ...synthetic.identity, [field]: dev.identity[field] } }, 'prd')).toThrow('PRD bloqueado')
    }
    for (const apiBaseUrl of [dev.apiBaseUrl, 'http://localhost:8787', 'https://api.example.test', 'https://user:SYNTHETIC_ONLY@api.sabara.org']) {
      expect(() => validateFutebolEnvironment({ ...synthetic, apiBaseUrl }, 'prd')).toThrow('PRD bloqueado')
    }
  })
  it('requires the configured root origin, including when returning an OAuth code', () => {
    const config = validateFutebolEnvironment(dev, 'dev')
    expect(() => assertFutebolLocation(new URL('http://localhost:5173/?code=synthetic&state=synthetic'), config)).not.toThrow()
    for (const url of ['http://127.0.0.1:5173/', 'http://localhost:5173/futebol/', 'https://futebol.sabara.org/']) {
      expect(() => assertFutebolLocation(new URL(url), config)).toThrow()
    }
  })
})
