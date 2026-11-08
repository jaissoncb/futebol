import { searchPlayers } from './player-search'
import { players } from '../matches/test-fixtures'

it('encontra nome e apelido sem acento, caixa ou espaços extras, sem alterar o elenco', () => {
  const roster = [{ ...players[0]!, name: 'João da Silva', nickname: 'Goleirão' }, players[1]!]
  const before = structuredClone(roster)
  expect(searchPlayers(roster, '  JOAO  goleirao ')).toEqual([roster[0]])
  expect(searchPlayers(roster, 'não existe')).toEqual([])
  expect(searchPlayers(roster, '')).toEqual(roster)
  expect(roster).toEqual(before)
})
