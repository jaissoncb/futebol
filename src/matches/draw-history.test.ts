import { loadDrawHistory } from './draw-history'
import { IncompleteSavedMatchError, validateSavedMatch } from './match-service'
import type { FutebolDataClient } from '../lib/data-client'
import { group, saved } from './test-fixtures'

const signal = new AbortController().signal

it('uses final saved assignments and reserve flags, including manual changes', async () => {
  const edited = structuredClone(saved)
  const [first, second] = edited.assignments.filter(row => row.starts_as_reserve)
  ;[first!.player_id, second!.player_id] = [second!.player_id, first!.player_id]
  first!.assignment_source = 'manual'
  const client = {
    history: vi.fn(() => Promise.resolve([edited.match, { ...edited.match, group_id: 'another' },
      { ...edited.match, match_date: '2026-09-13' }])),
    savedMatch: vi.fn(() => Promise.resolve(validateSavedMatch(edited))),
  }
  const snapshot = await loadDrawHistory(client as unknown as FutebolDataClient, group.id, '2026-09-12', '21:00', signal)
  expect(snapshot[0]?.[0]?.reserveIds).toEqual([first!.player_id])
  expect(snapshot[0]?.[1]?.reserveIds).toEqual([second!.player_id])
  expect(client.history).toHaveBeenCalledTimes(1)
  expect(client.savedMatch).toHaveBeenCalledTimes(1)
})

it('skips incomplete graphs and bounds detail calls, concurrency and accepted matches', async () => {
  const rows = Array.from({ length: 50 }, (_, index) => ({ ...saved.match, id: String(index) }))
  let active = 0
  let peak = 0
  const client = {
    history: vi.fn(() => Promise.resolve(rows)),
    savedMatch: vi.fn(async (_group: string, id: string) => {
      active++
      peak = Math.max(peak, active)
      await Promise.resolve()
      active--
      if (Number(id) < 5) throw new IncompleteSavedMatchError()
      return { ...saved, match: { ...saved.match, id } }
    }),
  }
  const load = () => loadDrawHistory(client as unknown as FutebolDataClient, group.id, '2026-09-13', '', signal)
  expect(await load()).toHaveLength(9)
  expect(client.savedMatch).toHaveBeenCalledTimes(14)
  expect(peak).toBe(2)
  client.savedMatch.mockClear()
  client.savedMatch.mockImplementation((_group, id) => Promise.resolve({ ...saved, match: { ...saved.match, id } }))
  expect(await load()).toHaveLength(10)
  expect(client.savedMatch).toHaveBeenCalledTimes(10)
})
