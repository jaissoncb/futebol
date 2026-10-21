import { describe, expect, it, vi } from 'vitest'
import { createApiClient } from './client'

describe('isolated DEV HTTP client preparation', () => {
  it('sends bearer in a header only; no cookies, browser cache or redirects', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ id: 'fixture' })))
    const client = createApiClient('http://localhost:8787', () => Promise.resolve('synthetic-token'), transport)
    expect(await client.request('/me')).toEqual({ id: 'fixture' })
    const [url, options] = transport.mock.calls[0]!
    expect((url as URL).href).toBe('http://localhost:8787/me')
    expect(options).toMatchObject({ credentials: 'omit', cache: 'no-store', redirect: 'error', headers: { Authorization: 'Bearer synthetic-token' } })
    expect(localStorage.length).toBe(0)
  })
  it('prevents account mixing when logout occurs during token acquisition', async () => {
    let release!: (value: string) => void
    const token = new Promise<string>(resolve => { release = resolve })
    const transport = vi.fn<typeof fetch>()
    const client = createApiClient('http://localhost:8787', () => token, transport)
    const pending = client.request('/me')
    client.close(); release('synthetic-old-token')
    await expect(pending).rejects.toMatchObject({ status: 401 })
    expect(transport).not.toHaveBeenCalled()
    await expect(client.request('/me')).rejects.toMatchObject({ status: 401 })
  })
  it('aborts old requests and rejects late responses even if transport ignores abort', async () => {
    let release!: (value: Response) => void
    const response = new Promise<Response>(resolve => { release = resolve })
    const transport = vi.fn<typeof fetch>().mockReturnValue(response)
    const client = createApiClient('http://localhost:8787', () => Promise.resolve('synthetic-token'), transport)
    const pending = client.request('/me')
    await vi.waitFor(() => expect(transport).toHaveBeenCalledOnce())
    client.close()
    expect(transport.mock.calls[0]![1]?.signal?.aborted).toBe(true)
    release(new Response(JSON.stringify({ private: 'old-user' })))
    await expect(pending).rejects.toMatchObject({ status: 401 })
  })
  it('rejects alternate origins/redirect destinations and never fetches without a token', async () => {
    const transport = vi.fn<typeof fetch>()
    const client = createApiClient('http://localhost:8787', () => Promise.resolve(null), transport)
    for (const path of ['https://attacker.test/', '//attacker.test/', '/\\attacker.test/']) {
      await expect(client.request(path)).rejects.toMatchObject({ status: 400 })
    }
    await expect(client.request('/me')).rejects.toMatchObject({ status: 401 })
    expect(transport).not.toHaveBeenCalled()
    for (const base of ['http://other.test', 'https://user:password@other.test', 'https://other.test/path', 'https://other.test?token=bad']) {
      expect(() => createApiClient(base, () => Promise.resolve(null))).toThrow()
    }
  })
})
