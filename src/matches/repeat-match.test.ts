import { repeatMatch } from './repeat-match'
import { group, players, saved } from './test-fixtures'
import { localDateInputValue } from '../draw/local-date'

it('prepara hoje e os participantes ativos atuais, sem reutilizar partida ou escalação salva', () => {
  const snapshot = structuredClone(saved)
  const draft = repeatMatch(saved, group.id, [players[0]!, { ...players[1]!, active: false }, { ...players[2]!, group_id: 'outro' }])
  expect(draft.selectedIds).toEqual([players[0]!.id])
  expect(draft.unavailable).toBe(3)
  expect(draft.config.matchDate).toBe(localDateInputValue())
  expect(draft.config.teamCount).toBe(saved.match.team_count)
  expect(draft).not.toHaveProperty('id')
  expect(draft).not.toHaveProperty('teams')
  expect(saved).toEqual(snapshot)
})
it('recusa uma partida de outro grupo', () => {
  expect(() => repeatMatch(saved, 'outro', players)).toThrow('outro grupo')
})
