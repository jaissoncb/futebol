import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { authorizeDrafts, discardCorruptDraft, draftScope, invalidateDrafts, readDraft, writeDraft } from './store'
import { isPlayerDraft } from './models'

const player = { name: 'Ana', nickname: null, active: true, isGoalkeeper: false, preferredPosition: null, skillRating: 3 }
const authorize = (groups = ['a', 'b'], user = 'u', environment = 'dev' as 'dev' | 'prd') =>
  authorizeDrafts(environment, user, groups, new AbortController().signal)

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('IDBKeyRange', IDBKeyRange)
})
afterEach(() => vi.unstubAllGlobals())

async function raw(version: number, action: (db: IDBDatabase) => void) {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('futebol-drafts', version)
    request.onerror = () => reject(request.error ?? new Error())
    request.onsuccess = () => {
      try { action(request.result); resolve() } catch (error) { reject(error instanceof Error ? error : new Error()) }
      finally { request.result.close() }
    }
  })
}

it('isola ambiente, conta, grupo e tipo e conserva apenas campos do formulário', async () => {
  const dev = await authorize()
  const prd = await authorize(['a'], 'u', 'prd')
  const a = draftScope(dev, 'a')!
  await writeDraft(a, 'player', 0, player)
  for (const scope of [draftScope(dev, 'b')!, draftScope(prd, 'a')!]) {
    expect(await readDraft(scope, 'player', isPlayerDraft)).toEqual({ revision: 0, value: null })
  }
  expect(await readDraft(a, 'match', isPlayerDraft)).toEqual({ revision: 0, value: null })
  expect(await readDraft(a, 'player', isPlayerDraft)).toEqual({ revision: 1, value: player })
  const next = await authorize(['a'], 'outra')
  await expect(readDraft(a, 'player', isPlayerDraft)).rejects.toMatchObject({ issue: 'revoked' })
  expect(await readDraft(draftScope(next, 'a')!, 'player', isPlayerDraft)).toMatchObject({ value: null })
  expect(await readDraft(draftScope(await authorize(), 'a')!, 'player', isPlayerDraft)).toMatchObject({ value: null })
})

it('mantém a revisão na reabertura e recusa sobrescrita concorrente e ressurreição após descarte', async () => {
  const a = draftScope(await authorize(), 'a')!
  const b = draftScope(await authorize(), 'a')!
  const results = await Promise.allSettled([writeDraft(a, 'player', 0, player), writeDraft(b, 'player', 0, { ...player, name: 'Bia' })])
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
  expect(results.find(r => r.status === 'rejected')).toMatchObject({ reason: { issue: 'conflict' } })
  vi.setSystemTime(new Date(Date.now() + 365 * 86400_000))
  try {
    expect(await readDraft(draftScope(await authorize(), 'a')!, 'player', isPlayerDraft)).toMatchObject({ revision: 1, value: { active: true } })
  } finally { vi.useRealTimers() }
  await writeDraft(a, 'player', 1, null)
  await expect(writeDraft(b, 'player', 1, player)).rejects.toMatchObject({ issue: 'conflict' })
  expect(await readDraft(a, 'player', isPlayerDraft)).toEqual({ revision: 2, value: null })
})

it('revoga o grant anterior e conserva os dados do grupo ainda autorizado', async () => {
  const access = await authorize()
  const a = draftScope(access, 'a')!
  const b = draftScope(access, 'b')!
  await writeDraft(a, 'player', 0, player)
  await writeDraft(b, 'player', 0, player)
  const onlyB = await authorize(['b'])
  await expect(writeDraft(a, 'player', 1, player)).rejects.toMatchObject({ issue: 'revoked' })
  await expect(authorizeDrafts('dev', 'u', ['a', 'b'], new AbortController().signal, access)).rejects.toMatchObject({ issue: 'revoked' })
  expect(await readDraft(draftScope(onlyB, 'b')!, 'player', isPlayerDraft)).toMatchObject({ value: player })
  expect(await readDraft(draftScope(await authorize(), 'a')!, 'player', isPlayerDraft)).toMatchObject({ value: null })
})

it('impede que autorização e escrita iniciadas antes do logout reabram o rascunho', async () => {
  const access = await authorize()
  const a = draftScope(access, 'a')!
  const controller = new AbortController()
  const renewal = authorizeDrafts('dev', 'u', ['a'], controller.signal, access)
  const late = writeDraft(a, 'player', 0, player)
  const results = Promise.allSettled([renewal, late])
  controller.abort()
  await invalidateDrafts('dev')
  for (const result of await results) expect(result).toMatchObject({ status: 'rejected', reason: { issue: 'revoked' } })
  expect(await readDraft(draftScope(await authorize(), 'a')!, 'player', isPlayerDraft)).toMatchObject({ value: null })
})

it('fecha o acesso da aba sem invalidar o rascunho durável após uma recusa ambígua', async () => {
  const access = await authorize()
  const lease = new AbortController()
  const scope = draftScope({ ...access, signal: lease.signal }, 'a')!
  await writeDraft(scope, 'player', 0, player)
  const pendingWrite = writeDraft(scope, 'player', 1, { ...player, name: 'Outra revisão' })
  lease.abort()
  await expect(pendingWrite).rejects.toMatchObject({ issue: 'revoked' })
  await expect(readDraft(scope, 'player', isPlayerDraft)).rejects.toMatchObject({ issue: 'revoked' })
  const revalidated = await authorizeDrafts('dev', 'u', ['a'], new AbortController().signal, access)
  expect(await readDraft(draftScope(revalidated, 'a')!, 'player', isPlayerDraft)).toEqual({ revision: 1, value: player })
})

it('rejeita conteúdo corrompido e protege um schema futuro contra descarte', async () => {
  const a = draftScope(await authorize(), 'a')!
  await writeDraft(a, 'player', 0, { ...player, refresh_token: 'fixture' })
  await expect(readDraft(a, 'player', isPlayerDraft)).rejects.toMatchObject({ issue: 'corrupt' })
  await discardCorruptDraft(a, 'player', isPlayerDraft)
  expect(await readDraft(a, 'player', isPlayerDraft)).toEqual({ revision: 2, value: null })
  await raw(1, db => {
    db.transaction('drafts', 'readwrite').objectStore('drafts').put({ key: ['dev', 'u', 'a', 'player'], schema: 2, revision: 3, value: player })
  })
  await expect(readDraft(a, 'player', isPlayerDraft)).rejects.toMatchObject({ issue: 'version' })
  await expect(discardCorruptDraft(a, 'player', isPlayerDraft)).rejects.toMatchObject({ issue: 'conflict' })
  await raw(2, () => undefined)
  await expect(readDraft(a, 'player', isPlayerDraft)).rejects.toMatchObject({ name: 'VersionError' })
})
