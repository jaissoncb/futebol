import { userEvent } from '@testing-library/user-event'
import { act, render, screen, waitFor } from '@testing-library/react'
import { GameFlow } from '../draw/GameFlow'
import type { FutebolDataClient } from '../lib/data-client'
import { group, players, saved } from '../matches/test-fixtures'

function fixture() {
  let close = () => {}
  const client = {
    history: vi.fn(() => Promise.resolve([saved.match])),
    savedMatch: vi.fn(() => Promise.resolve(saved)),
    isClosed: () => false,
    subscribeClosed: (listener: () => void) => { close = listener; return () => {} },
  } satisfies Partial<FutebolDataClient>
  return { client, close: () => close() }
}

async function enable(user: ReturnType<typeof userEvent.setup>) {
  expect(screen.queryByRole('checkbox', { name: 'Evitar repetições recentes' })).toBeNull()
  await user.selectOptions(screen.getByLabelText('Modo de sorteio'), 'balanced')
  const option = screen.getByRole('checkbox', { name: 'Evitar repetições recentes' })
  expect(option).not.toBeChecked()
  await user.click(option)
  await user.click(screen.getByRole('button', { name: 'Selecionar participantes' }))
  await user.click(screen.getByRole('button', { name: 'Selecionar todos' }))
}

it('reuses the history snapshot on reroll and distinguishes the count from the lineup', async () => {
  const user = userEvent.setup()
  const { client } = fixture()
  render(<GameFlow group={group} players={players} client={client as unknown as FutebolDataClient} />)
  await enable(user)
  await user.click(screen.getByRole('button', { name: 'Sortear times' }))
  expect(await screen.findByText(/1 partida\(s\) considerada\(s\)/)).toHaveTextContent('No sorteio-base')
  await user.click(screen.getByRole('button', { name: 'Novo sorteio' }))
  await screen.findByText(/2 sorteio\(s\)/)
  expect(client.history).toHaveBeenCalledTimes(1)
  expect(client.savedMatch).toHaveBeenCalledWith(group.id, saved.match.id)
  expect(client.savedMatch).toHaveBeenCalledTimes(1)
})

it('requires an explicit opt-out after an API failure and retries successfully', async () => {
  const user = userEvent.setup()
  const { client } = fixture()
  client.history.mockRejectedValueOnce(new Error()).mockRejectedValueOnce(new Error()).mockResolvedValueOnce([])
  render(<GameFlow group={group} players={players} client={client as unknown as FutebolDataClient} />)
  await enable(user)
  await user.click(screen.getByRole('button', { name: 'Sortear times' }))
  await screen.findByRole('alert')
  expect(screen.queryByRole('heading', { name: 'Times sorteados' })).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Sortear times' }))
  await screen.findByRole('alert')
  await user.click(screen.getByRole('button', { name: 'Sortear times' }))
  await screen.findByText(/Histórico insuficiente/)
  expect(client.history).toHaveBeenCalledTimes(3)
})

it('allows drawing without history after explicitly disabling it', async () => {
  const user = userEvent.setup()
  const { client } = fixture()
  client.history.mockRejectedValueOnce(new Error())
  render(<GameFlow group={group} players={players} client={client as unknown as FutebolDataClient} />)
  await enable(user)
  await user.click(screen.getByRole('button', { name: 'Sortear times' }))
  await user.click(await screen.findByRole('button', { name: 'Desativar histórico' }))
  await user.click(screen.getByRole('button', { name: 'Sortear times' }))
  await screen.findByRole('heading', { name: 'Times sorteados' })
  expect(screen.queryByText(/partida\(s\) considerada/)).toBeNull()
  expect(client.history).toHaveBeenCalledTimes(1)
})

it('discards an in-flight history response on session close', async () => {
  const user = userEvent.setup()
  const { client, close } = fixture()
  let resolve!: (value: typeof saved.match[]) => void
  client.history.mockReturnValueOnce(new Promise(done => { resolve = done }))
  render(<GameFlow group={group} players={players} client={client as unknown as FutebolDataClient} />)
  await enable(user)
  await user.click(screen.getByRole('button', { name: 'Sortear times' }))
  await waitFor(() => expect(client.history).toHaveBeenCalledTimes(1))
  await act(() => { close(); resolve([saved.match]); return Promise.resolve() })
  expect(client.savedMatch).not.toHaveBeenCalled()
  expect(screen.queryByRole('heading', { name: 'Times sorteados' })).toBeNull()
})

it('loads a new history snapshot when the group workspace changes', async () => {
  const user = userEvent.setup()
  const { client } = fixture()
  client.history.mockResolvedValueOnce([]).mockResolvedValueOnce([])
  const data = client as unknown as FutebolDataClient
  const view = render(<GameFlow key={group.id} group={group} players={players} client={data} />)
  await enable(user)
  await user.click(screen.getByRole('button', { name: 'Sortear times' }))
  await screen.findByText(/Histórico insuficiente/)

  const nextGroup = { ...group, id: 'another' }
  view.rerender(<GameFlow key={nextGroup.id} group={nextGroup} players={players.map(player => ({ ...player, group_id: nextGroup.id }))} client={data} />)
  expect(screen.queryByText(/Histórico insuficiente/)).toBeNull()
  await enable(user)
  await user.click(screen.getByRole('button', { name: 'Sortear times' }))
  await screen.findByText(/Histórico insuficiente/)
  expect(client.history.mock.calls).toEqual([[group.id, 0], [nextGroup.id, 0]])
})
