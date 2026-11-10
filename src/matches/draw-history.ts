import type { HistoricalSnapshot } from '../draw/historical-engine'
import type { FutebolDataClient } from '../lib/data-client'
import { IncompleteSavedMatchError, loadMatchHistory, loadSavedMatch } from './match-service'

export const HISTORICAL_MATCH_LIMIT = 10
const DETAIL_LIMIT = 14
const CONCURRENCY = 2

/** Use one ordered history page and a bounded number of authorized graphs. */
export async function loadDrawHistory(client: FutebolDataClient, groupId: string, date: string, time: string, signal: AbortSignal): Promise<HistoricalSnapshot> {
  const history = await loadMatchHistory(client, groupId)
  const candidates = history.filter(match => match.group_id === groupId && match.status === 'drawn' &&
    (match.match_date < date || (match.match_date === date && (!time || !match.match_time || match.match_time.slice(0, 5) < time))))
  const snapshot: (HistoricalSnapshot[number])[] = []
  for (let index = 0; index < Math.min(candidates.length, DETAIL_LIMIT) && snapshot.length < HISTORICAL_MATCH_LIMIT; index += CONCURRENCY) {
    signal.throwIfAborted()
    const batch = await Promise.allSettled(candidates.slice(index, index + CONCURRENCY).map(async match => {
      try {
        const saved = await loadSavedMatch(client, groupId, match.id)
        if (saved.match.group_id !== groupId || saved.match.id !== match.id) return null
        return saved.teams.map(team => {
          const rows = saved.assignments.filter(row => row.team_id === team.id)
          return {
            playerIds: rows.map(row => row.player_id),
            reserveIds: rows.filter(row => row.starts_as_reserve).map(row => row.player_id),
          }
        })
      } catch (cause) {
        if (cause instanceof IncompleteSavedMatchError) return null
        throw cause
      }
    }))
    signal.throwIfAborted()
    for (const result of batch) {
      if (result.status === 'rejected') throw result.reason
      if (result.value && snapshot.length < HISTORICAL_MATCH_LIMIT) snapshot.push(result.value)
    }
  }
  signal.throwIfAborted()
  return snapshot
}
