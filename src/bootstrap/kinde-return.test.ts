import { describe, expect, it } from 'vitest'
import { cleanKindeCallback, readKindeCallbackStatus, safeKindeReturnHash } from './kinde-return'

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
  it('rejects provider errors, incomplete/duplicate parameters and implicit token responses', () => {
    expect(readKindeCallbackStatus(new URL('http://localhost:5173/'))).toBe('none')
    expect(readKindeCallbackStatus(new URL('http://localhost:5173/?code=fixture&state=fixture'))).toBe('code')
    for (const query of ['error=fixture','error_description=fixture','code=fixture','state=fixture',
      'code=fixture&state=', 'code=fixture&code=other&state=fixture', 'access_token=fixture', 'id_token=fixture', 'refresh_token=fixture']) {
      expect(readKindeCallbackStatus(new URL(`http://localhost:5173/?${query}`))).toBe('reject')
    }
    expect(readKindeCallbackStatus(new URL('http://localhost:5173/#token_type=Bearer&access_token=fixture'))).toBe('reject')
  })
})
