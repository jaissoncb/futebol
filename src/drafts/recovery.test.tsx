import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { GroupDashboard } from '../groups/GroupDashboard'
import { MatchWorkspace } from '../matches/MatchWorkspace'
import { group, players } from '../matches/test-fixtures'
import { createFutebolApiServices } from '../lib/api/services'
import { authorizeDrafts, draftScope, readDraft } from './store'
import { isMatchDraft, isPlayerDraft } from './models'

const userId = 'd0000000-0000-0000-0000-000000000001'
const user = () => userEvent.setup()
const button = (name: string) => screen.getByRole('button', { name })
const configuration = () => screen.findByRole('textbox', { name: /Nome.*opcional/ })
const savedLocally = () => screen.findByText('Rascunho guardado neste dispositivo.')

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('IDBKeyRange', IDBKeyRange)
})
afterEach(() => vi.unstubAllGlobals())

async function fixture() {
  const data = { groups: [group], players }
  const drafts = await authorizeDrafts('dev', userId, [group.id], new AbortController().signal)
  const scope = draftScope(drafts, group.id)!
  const put = vi.fn<(id: string, payload: unknown) => Promise<Response>>()
  const get = vi.fn<(path: string) => Response>().mockImplementation(() => Response.json({}, { status: 404 }))
  const transport: typeof fetch = async (input, options) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (options?.method === 'PUT') {
      const id = url.pathname.split('/')[2]!
      if (typeof options.body !== 'string') throw new Error('Payload ausente')
      const body: unknown = JSON.parse(options.body)
      const stored = await readDraft(scope, 'match', isMatchDraft)
      expect(stored.value?.attempt).toEqual({ id, payload: body })
      expect(JSON.stringify(stored)).not.toMatch(/access_token|refresh_token|Cookie|fixture-bearer/)
      return put(id, body)
    }
    if (url.pathname.endsWith('/matches')) return Response.json([])
    return get(url.pathname)
  }
  const client = createFutebolApiServices('https://fixture.test', () => Promise.resolve('fixture-bearer'), transport)
  return {
    drafts, scope, client, put, get, data,
    mount: () => render(<MatchWorkspace group={group} players={players} client={client} scope={scope} requireDurable />),
  }
}

async function draw(action: ReturnType<typeof user>, name = 'Partida teste') {
  await action.type(await configuration(), name)
  await action.click(button('Selecionar participantes'))
  await action.click(button('Selecionar todos'))
  await action.click(button('Sortear times'))
  await screen.findByRole('heading', { name: 'Times sorteados' })
  await savedLocally()
}

it('recupera detalhes, seleção, regra, rodadas e ajuste após fechar o documento', async () => {
  const f = await fixture()
  const action = user()
  let view = f.mount()
  fireEvent.change(await configuration(), { target: { value: 'Partida recuperada' } })
  expect(screen.queryByText('Rascunho guardado neste dispositivo.')).toBeNull()
  fireEvent(window, new Event('pagehide'))
  await savedLocally()
  view.unmount()
  view = f.mount()
  expect(await configuration()).toHaveValue('Partida recuperada')
  await action.click(button('Selecionar participantes'))
  await action.click(button('Selecionar todos'))
  await action.click(button('Adicionar regra'))
  await action.selectOptions(screen.getByLabelText('Tipo de regra'), 'fixed')
  await action.selectOptions(screen.getByLabelText('Primeiro jogador'), players[0]!.id)
  await action.selectOptions(screen.getByLabelText('Time fixo'), '0')
  await action.click(button('Ativar regra'))
  await action.click(button('Sortear times'))
  await screen.findByRole('heading', { name: 'Times sorteados' })
  await action.click(button('Novo sorteio'))
  await screen.findByText(/2 sorteio\(s\) nesta partida/)
  await action.click(screen.getAllByRole('button', { name: /Selecionar para ajuste/ })[0]!)
  await action.click(screen.getAllByRole('button', { name: 'Trocar titular/reserva' })[0]!)
  await screen.findByText(/Ajustado manualmente/)
  await savedLocally()
  const previous = await readDraft(f.scope, 'match', isMatchDraft)
  expect(previous.value).toMatchObject({ step: 'result', selected: players.map(p => p.id), rules: [{ kind: 'fixed', player: players[0]!.id, team: 0 }] })
  expect(previous.value?.runs).toHaveLength(2)
  view.unmount()
  f.mount()
  await screen.findByText(/Ajustado manualmente/)
  expect(screen.getByText(/1 regra\(s\) ativa/)).toBeVisible()
  expect(screen.getByText(/2 sorteio\(s\) nesta partida/)).toBeVisible()
  expect(await readDraft(f.scope, 'match', isMatchDraft)).toEqual(previous)
})

it('reabre cadastro parcial com valores exatos e nenhum POST', async () => {
  const f = await fixture()
  const createPlayer = vi.fn()
  const client = { ...f.client, createPlayer }
  const mount = () => render(<GroupDashboard client={client} userId={userId} verifiedData={f.data} drafts={f.drafts} />)
  const action = user()
  const view = mount()
  await action.click(await screen.findByRole('button', { name: 'Adicionar' }))
  const form = () => within(screen.getByRole('region', { name: 'Novo jogador' }))
  await action.type(form().getByRole('textbox', { name: 'Nome' }), 'Cadastro parcial')
  await action.click(form().getByLabelText(/É goleiro/))
  await form().findByText('Rascunho guardado neste dispositivo.')
  view.unmount()
  mount()
  await screen.findByRole('region', { name: 'Novo jogador' })
  expect(form().getByRole('textbox', { name: 'Nome' })).toHaveValue('Cadastro parcial')
  expect(form().getByLabelText(/É goleiro/)).toBeChecked()
  expect(createPlayer).not.toHaveBeenCalled()
  expect((await readDraft(f.scope, 'player', isPlayerDraft)).value).toEqual({
    name: 'Cadastro parcial', nickname: '', active: true, isGoalkeeper: true, preferredPosition: null, skillRating: 3,
  })
})

function graph(id: string, payload: NonNullable<Awaited<ReturnType<typeof readMatch>>>['payload']) {
  return {
    match: { ...payload, id, created_by: userId, status: 'drawn', match_time: payload.match_time && payload.match_time + ':00' },
    participants: payload.participants.map(p => ({ ...p, attendance_status: 'present' })),
    teams: payload.teams.map(team => ({ ...team, id: String(team.team_index) })),
    assignments: payload.assignments.map(a => ({ ...a, team_id: String(a.team_index) })),
    runs: payload.draw_runs.map(run => ({ ...run, balance_score: Math.round(run.balance_score * 1000) / 1000 })),
  }
}

async function readMatch(scope: Awaited<ReturnType<typeof fixture>>['scope']) {
  return (await readDraft(scope, 'match', isMatchDraft)).value?.attempt
}

it.each(['confirmada', 'inconclusiva', 'divergente'] as const)('recupera tentativa com resposta perdida e leitura %s', async outcome => {
  const f = await fixture()
  const action = user()
  const view = f.mount()
  await draw(action)
  f.put.mockRejectedValueOnce(new TypeError('transporte'))
  await action.click(button('Salvar e aceitar sorteio'))
  await screen.findByText(/ainda não apareceu no histórico/)
  const frozen = (await readMatch(f.scope))!
  expect(f.put).toHaveBeenCalledExactlyOnceWith(frozen.id, frozen.payload)
  view.unmount()
  const expectedPath = '/groups/' + group.id + '/matches/' + frozen.id
  if (outcome !== 'inconclusiva') {
    const response = graph(frozen.id, frozen.payload)
    if (outcome === 'divergente') response.match.name = 'Outro conteúdo'
    f.get.mockImplementation(path => path === expectedPath ? Response.json(response) : Response.json({}, { status: 404 }))
  }
  f.mount()
  await waitFor(() => expect(f.get).toHaveBeenLastCalledWith(expectedPath))
  if (outcome === 'confirmada') {
    await screen.findByText(/Partida salva e sorteio aceito/)
    expect(await readMatch(f.scope)).toBeUndefined()
  } else if (outcome === 'divergente') {
    await screen.findByText(/histórico contém dados diferentes/)
    expect(button('Tentar salvar novamente')).toBeDisabled()
    await action.click(button('Tentar salvar novamente'))
  } else {
    await screen.findByText(/ainda não apareceu no histórico/)
    expect(f.put).toHaveBeenCalledTimes(1)
    f.put.mockResolvedValueOnce(Response.json({ id: frozen.id }))
    await action.click(button('Tentar salvar novamente'))
    await screen.findByText(/Partida salva e sorteio aceito/)
    expect(f.put).toHaveBeenNthCalledWith(2, frozen.id, frozen.payload)
  }
  expect(f.put).toHaveBeenCalledTimes(outcome === 'inconclusiva' ? 2 : 1)
})

it('informa falha local e bloqueia PUT quando a tentativa não pode ser persistida', async () => {
  const f = await fixture()
  const action = user()
  f.mount()
  await draw(action)
  act(() => { vi.stubGlobal('indexedDB', undefined) })
  await action.click(button('Salvar e aceitar sorteio'))
  await screen.findByText(/armazenamento local está indisponível/)
  expect(screen.queryByText('Rascunho guardado neste dispositivo.')).toBeNull()
  expect(f.put).not.toHaveBeenCalled()
})
