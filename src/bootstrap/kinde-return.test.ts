import { describe, expect, it } from 'vitest'
import { cleanKindeCallback, safeKindeReturnHash } from './kinde-return'

describe('Kinde callback route preparation', () => {
  it('restores only known internal routes', () => {
    expect(safeKindeReturnHash('#/conta')).toBe('#/conta')
    for (const value of [undefined, '//evil.test', 'https://evil.test', '#//evil.test', '#/conta?token=fixture', '#/../../evil']) {
      expect(safeKindeReturnHash(value)).toBe('#/')
    }
  })
  it('cleans query parameters before handing over to HashRouter', () => {
    const url = new URL('http://localhost:5173/?code=fixture&state=fixture&error_description=fixture#/login')
    expect(cleanKindeCallback(url, '#/conta')).toBe('/#/conta')
    expect(() => cleanKindeCallback(new URL('http://localhost:5173/callback'), '#/')).toThrow()
    expect(() => cleanKindeCallback(new URL('http://127.0.0.1:5173/'), '#/')).toThrow()
  })
})
