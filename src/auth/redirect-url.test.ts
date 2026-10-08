import { authRedirectUrl } from './redirect-url'

describe('authRedirectUrl', () => {
  it('usa a raiz do domínio oficial planejado', () => {
    expect(authRedirectUrl('https://futebol.sabara.org')).toBe('https://futebol.sabara.org/')
  })

  it('usa a raiz do origin local sem preservar paths, query ou hash', () => {
    expect(authRedirectUrl('http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173/')
  })
})
