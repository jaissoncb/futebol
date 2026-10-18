import { afterEach, describe, expect, it, vi } from 'vitest'
import { createG3BrowserProbe } from './g3-probe'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
describe('G3 browser diagnostic transport', () => {
  it('sends SDK memory tokens directly, tests ID separately, waits TTL and handles SDK refreshed token', async () => {
    vi.useFakeTimers()
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', transport)
    const report = vi.fn<(message: string) => void>()
    const probe = createG3BrowserProbe(report)
    await probe.start('synthetic-access', 'synthetic-id')
    expect(transport.mock.calls.map(([url]) => url)).toEqual([
      'http://localhost:8787/__dev/g3?phase=initial',
      'http://localhost:8787/__dev/g3?phase=id_negative',
      'http://localhost:8787/__dev/g3?phase=cache',
    ])
    expect(transport.mock.calls[0]![1]).toMatchObject({ credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers: { Authorization: 'Bearer synthetic-access' } })
    expect(transport.mock.calls[1]![1]?.headers).toEqual({ Authorization: 'Bearer synthetic-id' })
    await vi.advanceTimersByTimeAsync(61000)
    expect(transport.mock.lastCall![0]).toBe('http://localhost:8787/__dev/g3?phase=after_ttl')
    await probe.refreshed('synthetic-refreshed')
    expect(transport.mock.lastCall![1]?.headers).toEqual({ Authorization: 'Bearer synthetic-refreshed' })
    expect(report.mock.calls.flat().join(' ')).not.toMatch(/synthetic/)
    probe.close()
    const calls = transport.mock.calls.length
    await probe.refreshed('late-token'); expect(transport).toHaveBeenCalledTimes(calls)
    expect(transport.mock.calls[0]![1]?.signal?.aborted).toBe(true)
  })
  it('401 initial stops scheduled probes and no diagnostics run without explicit start', async () => {
    vi.useFakeTimers()
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }))
    vi.stubGlobal('fetch', transport)
    const probe = createG3BrowserProbe(vi.fn())
    await probe.refreshed('unused'); expect(transport).not.toHaveBeenCalled()
    await probe.start('synthetic-denied', undefined)
    await vi.advanceTimersByTimeAsync(61000)
    expect(transport).toHaveBeenCalledOnce(); probe.close()
  })
})
