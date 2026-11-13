import { act, renderHook } from '@testing-library/react'
import { readDraft, writeDraft, type DraftScope } from './store'
import { useDraftAutosave, useDraftRecord } from './use-draft'

vi.mock('./store', async importOriginal => ({
  ...await importOriginal<typeof import('./store')>(), readDraft: vi.fn(), writeDraft: vi.fn(),
}))
const scope: DraftScope = { environment: 'dev', userId: 'u', groupId: 'g', epoch: 'e', grant: 'a' }
const validate = (value: unknown): value is string => typeof value === 'string'

function deferred() {
  let resolve!: (revision: number) => void
  let reject!: (error: Error) => void
  const promise = new Promise<number>((success, failure) => { resolve = success; reject = failure })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(readDraft).mockResolvedValue({ value: null, revision: 0 })
  vi.mocked(writeDraft).mockReset()
})
afterEach(() => vi.useRealTimers())

it('agrupa digitação, libera mudanças de etapa e só confirma quando a última transação conclui', async () => {
  const first = deferred()
  const second = deferred()
  vi.mocked(writeDraft).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  const view = renderHook(({ value, delay }: { value: string | null; delay: number }) => {
    const { record, status } = useDraftRecord(scope, 'match', validate)
    useDraftAutosave(record.state === 'ready' ? record.writer : undefined, value, delay)
    return status
  }, { initialProps: { value: null as string | null, delay: 180 } })
  await act(async () => { await Promise.resolve() })
  view.rerender({ value: 'A', delay: 180 })
  await act(() => vi.advanceTimersByTimeAsync(179))
  view.rerender({ value: 'AB', delay: 180 })
  await act(() => vi.advanceTimersByTimeAsync(179))
  expect(writeDraft).not.toHaveBeenCalled()
  await act(() => vi.advanceTimersByTimeAsync(1))
  expect(writeDraft).toHaveBeenCalledExactlyOnceWith(scope, 'match', 0, 'AB')
  expect(view.result.current).toBe('saving')
  view.rerender({ value: 'participantes', delay: 0 })
  await act(() => vi.advanceTimersByTimeAsync(0))
  await act(async () => { first.resolve(1); await first.promise })
  expect(writeDraft).toHaveBeenNthCalledWith(2, scope, 'match', 1, 'participantes')
  expect(view.result.current).toBe('saving')
  await act(async () => { second.resolve(2); await second.promise })
  expect(view.result.current).toBe('saved')
})

it('pagehide solicita a gravação imediatamente e quota mantém o estado sem proteção', async () => {
  const pending = deferred()
  vi.mocked(writeDraft).mockReturnValueOnce(pending.promise)
  const view = renderHook(({ value }: { value: string | null }) => {
    const { record, status } = useDraftRecord(scope, 'match', validate)
    useDraftAutosave(record.state === 'ready' ? record.writer : undefined, value, 180)
    return status
  }, { initialProps: { value: null as string | null } })
  await act(async () => { await Promise.resolve() })
  view.rerender({ value: 'em edição' })
  await act(async () => { window.dispatchEvent(new Event('pagehide')); await Promise.resolve() })
  expect(writeDraft).toHaveBeenCalledExactlyOnceWith(scope, 'match', 0, 'em edição')
  expect(view.result.current).toBe('saving')
  await act(async () => { pending.reject(new DOMException('quota', 'QuotaExceededError')); await pending.promise.catch(() => undefined) })
  expect(view.result.current).toBe('quota')
})
