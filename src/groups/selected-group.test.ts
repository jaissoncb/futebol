import { clearSelectedGroup, readSelectedGroup, rememberSelectedGroup } from './selected-group'

beforeEach(() => sessionStorage.clear())
afterEach(() => vi.restoreAllMocks())

it('armazena somente os identificadores e remove a preferência no logout', () => {
  rememberSelectedGroup('user', 'group')
  expect(JSON.parse(sessionStorage.getItem('futebol.selected-group.v1')!)).toEqual({ userId: 'user', groupId: 'group' })
  expect(readSelectedGroup('user')).toBe('group')
  clearSelectedGroup()
  expect(readSelectedGroup('user')).toBeNull()
})

it('descarta preferência de outro usuário, valor inválido e seleção vazia', () => {
  rememberSelectedGroup('user', 'group')
  expect(readSelectedGroup('other')).toBeNull()
  expect(sessionStorage.length).toBe(0)
  sessionStorage.setItem('futebol.selected-group.v1', '{broken')
  expect(readSelectedGroup('user')).toBeNull()
  rememberSelectedGroup('user', null)
  expect(sessionStorage.length).toBe(0)
})

it('não impede o uso quando o navegador bloqueia storage', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied') })
  expect(() => rememberSelectedGroup('user', 'group')).not.toThrow()
  expect(readSelectedGroup('user')).toBeNull()
  expect(() => clearSelectedGroup()).not.toThrow()
})
