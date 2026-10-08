import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GroupDashboard } from './GroupDashboard'
import * as service from './group-service'
import type { FutebolSupabaseClient } from '../lib/supabase/client'
import * as matches from '../matches/match-service'

vi.mock('../matches/match-service', async (original) => ({
  ...await original<typeof matches>(), loadMatchHistory: vi.fn(), loadSavedMatch: vi.fn(), saveMatchDraw: vi.fn(),
}))

vi.mock('./group-service', async (original) => ({
  ...await original<typeof service>(),
  loadGroupWorkspace: vi.fn(), createGroup: vi.fn(), updateGroup: vi.fn(),
  createPlayer: vi.fn(), updatePlayer: vi.fn(),
}))

const client = {} as FutebolSupabaseClient
const group: service.GroupWithRole = {
  id: 'a', name: 'Quarta', role: 'owner', sport: 'futsal', default_players_on_court: 5,
  created_by: 'user', created_at: '', updated_at: '',
}
const player: service.Player = {
  id: 'p1', group_id: 'a', name: 'Ana', nickname: null, active: true,
  skill_rating: 3.5, is_goalkeeper: false, preferred_position: null, created_at: '', updated_at: '',
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(service.loadGroupWorkspace).mockResolvedValue({ groups: [group], players: [player] })
})

it('cria o primeiro grupo e seleciona o resultado', async () => {
  const user = userEvent.setup()
  vi.mocked(service.loadGroupWorkspace).mockResolvedValueOnce({ groups: [], players: [] })
  vi.mocked(service.createGroup).mockResolvedValue('a')
  render(<GroupDashboard client={client} userId="user" />)
  await user.click(await screen.findByRole('button', { name: 'Criar grupo' }))
  await user.type(screen.getByLabelText('Nome'), 'Quarta')
  await user.click(screen.getByRole('button', { name: 'Salvar grupo' }))
  expect(await screen.findByRole('button', { name: 'Quarta' })).toHaveAttribute('aria-pressed', 'true')
  expect(service.createGroup).toHaveBeenCalledWith(client, { name: 'Quarta', sport: 'futsal', defaultPlayersOnCourt: 5 })
})

it('bloqueia submits repetidos e troca de formulário/grupo durante a gravação do jogador', async () => {
  const user = userEvent.setup()
  let resolve!: () => void
  vi.mocked(service.createPlayer).mockImplementation(() => new Promise<void>((done) => { resolve = done }))
  vi.mocked(service.loadGroupWorkspace).mockResolvedValue({ groups: [group, { ...group, id: 'b', name: 'Outro grupo' }], players: [player] })
  render(<GroupDashboard client={client} userId="user" />)
  await user.click(await screen.findByRole('button', { name: 'Adicionar' }))
  await user.type(screen.getByLabelText('Nome'), 'Duplicidade sintética')
  const form = screen.getByRole('button', { name: 'Salvar jogador' }).closest('form')!
  fireEvent.submit(form); fireEvent.submit(form)
  expect(service.createPlayer).toHaveBeenCalledOnce()
  expect(screen.getByRole('button', { name: 'Outro grupo' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Fechar' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Adicionar' })).toBeDisabled()
  await act(async () => { resolve(); await Promise.resolve() })
  expect(await screen.findByRole('button', { name: 'Outro grupo' })).toBeEnabled()
})

it.each(['member', 'admin'] as const)('respeita os controles do papel %s', async (role) => {
  vi.mocked(service.loadGroupWorkspace).mockResolvedValue({ groups: [{ ...group, role }], players: [player] })
  render(<GroupDashboard client={client} userId="user" />)
  await screen.findByText('Ana')
  expect(screen.queryByRole('button', { name: 'Ajustar grupo' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Adicionar' }) !== null).toBe(role === 'admin')
  expect(screen.queryByRole('button', { name: 'Editar' }) !== null).toBe(role === 'admin')
})

it('troca o formulário de jogador sem reutilizar os dados anteriores e permite desativar', async () => {
  const user = userEvent.setup()
  vi.mocked(service.loadGroupWorkspace).mockResolvedValue({ groups: [group], players: [player, { ...player, id: 'p2', name: 'Bia' }] })
  render(<GroupDashboard client={client} userId="user" />)
  await screen.findByText('Ana')
  await user.click(within(screen.getByText('Ana').closest('li')!).getByRole('button', { name: 'Editar' }))
  expect(screen.getByLabelText('Nome')).toHaveValue('Ana')
  await user.click(within(screen.getByText('Bia').closest('li')!).getByRole('button', { name: 'Editar' }))
  expect(screen.getByLabelText('Nome')).toHaveValue('Bia')
  await user.click(screen.getByLabelText('Jogador ativo'))
  await user.click(screen.getByRole('button', { name: 'Salvar jogador' }))
  await screen.findByText('Quem joga hoje?')
  expect(service.updatePlayer).toHaveBeenCalledWith(client, 'p2', expect.objectContaining({ name: 'Bia', active: false }))
})

it('preserva dados digitados após falha ao salvar sem exibir detalhes do servidor', async () => {
  const user = userEvent.setup()
  vi.mocked(service.createPlayer).mockRejectedValue(new Error('private server detail'))
  render(<GroupDashboard client={client} userId="user" />)
  await user.click(await screen.findByRole('button', { name: 'Adicionar' }))
  await user.type(screen.getByLabelText('Nome'), 'Carla')
  await user.click(screen.getByRole('button', { name: 'Salvar jogador' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível salvar o jogador')
  expect(screen.getByLabelText('Nome')).toHaveValue('Carla')
  expect(screen.queryByText('private server detail')).not.toBeInTheDocument()
})

it('salva ajustes do owner e cadastra jogador com nível e posição', async () => {
  const user = userEvent.setup()
  render(<GroupDashboard client={client} userId="user" />)
  await user.click(await screen.findByRole('button', { name: 'Ajustar grupo' }))
  await user.clear(screen.getByLabelText('Nome'))
  await user.type(screen.getByLabelText('Nome'), 'Sexta')
  await user.click(screen.getByRole('button', { name: 'Salvar grupo' }))
  await user.click(await screen.findByRole('button', { name: 'Adicionar' }))
  await user.type(screen.getByLabelText('Nome'), 'Dani')
  await user.selectOptions(screen.getByLabelText('Nível'), '4.5')
  await user.selectOptions(screen.getByLabelText('Posição'), 'goalkeeper')
  await user.click(screen.getByLabelText('É goleiro'))
  await user.click(screen.getByRole('button', { name: 'Salvar jogador' }))
  await screen.findByText('Quem joga hoje?')
  expect(service.updateGroup).toHaveBeenCalledWith(client, 'a', { name: 'Sexta', sport: 'futsal', defaultPlayersOnCourt: 5 })
  expect(service.createPlayer).toHaveBeenCalledWith(client, 'a', expect.objectContaining({ name: 'Dani', skillRating: 4.5, preferredPosition: 'goalkeeper', isGoalkeeper: true, active: true }))
})

it('mostra carregamento, erro e recupera pela nova tentativa', async () => {
  const user = userEvent.setup()
  vi.mocked(service.loadGroupWorkspace).mockRejectedValueOnce(new Error('offline'))
  render(<GroupDashboard client={client} userId="user" />)
  expect(screen.getByText('Carregando seus grupos…')).toBeInTheDocument()
  await user.click(await screen.findByRole('button', { name: 'Tentar novamente' }))
  expect(await screen.findByText('Ana')).toBeInTheDocument()
})

it('preserva retry durante recarga do elenco e bloqueia troca de grupo enquanto a resposta é incerta', async () => {
  const user = userEvent.setup()
  vi.mocked(service.loadGroupWorkspace).mockResolvedValue({ groups: [group, { ...group, id: 'b', name: 'Outro grupo' }], players: [player, { ...player, id: 'p2', name: 'Bia' }] })
  vi.mocked(matches.saveMatchDraw).mockRejectedValueOnce(new Error('timeout')).mockImplementation((_client, id) => Promise.resolve(id))
  vi.mocked(matches.loadMatchHistory).mockResolvedValue([])
  vi.mocked(matches.loadSavedMatch).mockImplementation(() => new Promise(() => {}))
  render(<GroupDashboard client={client} userId="user" />)
  await user.click(await screen.findByRole('button', { name: 'Criar outro grupo' }))
  await user.click(await screen.findByRole('button', { name: 'Selecionar participantes' }))
  await user.click(screen.getByRole('button', { name: 'Selecionar todos' }))
  await user.click(screen.getByRole('button', { name: 'Sortear times' }))
  await screen.findByRole('region', { name: 'Resultado do sorteio' })
  await user.click(screen.getByRole('button', { name: 'Salvar e aceitar sorteio' }))
  await screen.findByRole('alert')
  const first = vi.mocked(matches.saveMatchDraw).mock.calls[0]!
  expect(screen.getByRole('button', { name: 'Outro grupo' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Salvar grupo' })).toBeDisabled()
  const roster = screen.getByText('2 jogadores ativos').closest('section')!
  await user.click(within(roster).getAllByRole('button', { name: 'Editar' })[0]!)
  await user.click(screen.getByRole('button', { name: 'Salvar jogador' }))
  expect(await screen.findByRole('button', { name: 'Tentar salvar novamente' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: 'Tentar salvar novamente' }))
  await screen.findByText(/Partida salva e sorteio aceito/)
  expect(screen.getByRole('button', { name: 'Outro grupo' })).toBeEnabled()
  expect(vi.mocked(matches.saveMatchDraw).mock.calls[1]![1]).toBe(first[1])
  expect(vi.mocked(matches.saveMatchDraw).mock.calls[1]![2]).toBe(first[2])
})
