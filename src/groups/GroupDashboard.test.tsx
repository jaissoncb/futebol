import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { GroupDashboard } from './GroupDashboard'
import * as service from './group-service'
import type { FutebolDataClient } from '../lib/data-client'
import * as matches from '../matches/match-service'
import { FutebolWorkspace } from '../frontend/FutebolWorkspace'
import { ApiError } from '../lib/api/client'
import { ConfirmationSuspended } from '../useConfirmation'

vi.mock('../matches/match-service', async (original) => ({
  ...await original<typeof matches>(), loadMatchHistory: vi.fn(), loadSavedMatch: vi.fn(), saveMatchDraw: vi.fn(),
}))

vi.mock('./group-service', async (original) => ({
  ...await original<typeof service>(),
  loadGroupWorkspace: vi.fn(), createGroup: vi.fn(), updateGroup: vi.fn(),
  createPlayer: vi.fn(), updatePlayer: vi.fn(),
}))

const client = {} as FutebolDataClient
const group: service.GroupWithRole = {
  id: 'a', name: 'Quarta', role: 'owner', sport: 'futsal', default_players_on_court: 5,
  created_by: 'user', created_at: '', updated_at: '',
}
const player: service.Player = {
  id: 'p1', group_id: 'a', name: 'Ana', nickname: null, active: true,
  skill_rating: 3.5, is_goalkeeper: false, preferred_position: null, created_at: '', updated_at: '',
}

beforeEach(() => {
  sessionStorage.clear()
  vi.resetAllMocks()
  vi.mocked(service.loadGroupWorkspace).mockResolvedValue({ groups: [group], players: [player] })
})

it('exige EXCLUIR para o grupo exato; cancelar, Escape e fechar não enviam nenhuma escrita', async () => {
  const user = userEvent.setup()
  const deleteGroup = vi.fn().mockResolvedValue(undefined)
  render(<GroupDashboard client={{ ...client, deleteGroup }} userId="user" />)
  await act(() => vi.dynamicImportSettled())
  await screen.findByLabelText(/Nome.*opcional/)
  await user.click(await screen.findByRole('button', { name: 'Ajustar grupo' }))
  const open = () => user.click(screen.getByRole('button', { name: 'Excluir grupo' }))
  await open()
  let dialog = screen.getByRole('alertdialog')
  expect(dialog).toHaveAccessibleDescription(expect.stringContaining('“Quarta”'))
  expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus()
  const input = within(dialog).getByLabelText('Digite EXCLUIR')
  await user.type(input, 'excluir')
  expect(within(dialog).getByRole('button', { name: 'Excluir definitivamente' })).toBeDisabled()
  fireEvent(dialog, new Event('cancel', { cancelable: true }))
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Excluir grupo' })).toHaveFocus()
  await open()
  dialog = screen.getByRole('alertdialog')
  await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
  await open()
  fireEvent(screen.getByRole('alertdialog'), new Event('close'))
  expect(deleteGroup).not.toHaveBeenCalled()
  await open()
  await user.type(screen.getByLabelText('Digite EXCLUIR'), 'EXCLUIR')
  await user.click(screen.getByRole('button', { name: 'Excluir definitivamente' }))
  expect(deleteGroup).toHaveBeenCalledExactlyOnceWith(group.id)
  expect(await screen.findByRole('heading', { name: 'Monte a sua pelada.' })).toBeInTheDocument()
  expect(screen.getByText('Grupo excluído definitivamente.')).toBeInTheDocument()
})

it.each(['admin', 'member'] as const)('não oferece exclusão para %s', async role => {
  vi.mocked(service.loadGroupWorkspace).mockResolvedValue({ groups: [{ ...group, role }], players: [] })
  render(<GroupDashboard client={client} userId="user" />)
  await screen.findByRole('heading', { name: 'Quarta' })
  expect(screen.queryByRole('button', { name: 'Ajustar grupo' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Excluir grupo' })).not.toBeInTheDocument()
})

it('bloqueia mudança de grupo e novo DELETE até verificar um resultado incerto, inclusive após remontar', async () => {
  const user = userEvent.setup()
  let rejectWrite!: (error: unknown) => void
  const deleteGroup = vi.fn(() => new Promise<void>((_, reject) => { rejectWrite = reject }))
  const api = { ...client, deleteGroup }
  const other = { ...group, id: 'b', name: 'Domingo' }
  const otherPlayer = { ...player, id: 'p2', group_id: other.id, name: 'Bia' }
  vi.mocked(service.loadGroupWorkspace).mockResolvedValue({ groups: [group, other], players: [player, otherPlayer] })
  const view = render(<GroupDashboard client={api} userId="user" />)
  await user.click(await screen.findByRole('button', { name: 'Ajustar grupo' }))
  await user.click(screen.getByRole('button', { name: 'Excluir grupo' }))
  await user.type(screen.getByLabelText('Digite EXCLUIR'), 'EXCLUIR')
  await user.click(screen.getByRole('button', { name: 'Excluir definitivamente' }))
  expect(screen.getByRole('button', { name: 'Domingo' })).toBeDisabled()
  await act(() => { rejectWrite(new ApiError(0, 'transport')); return Promise.resolve() })
  expect(await screen.findByRole('button', { name: 'Consultar estado do grupo' })).toBeInTheDocument()
  expect(deleteGroup).toHaveBeenCalledOnce()
  view.unmount()
  render(<GroupDashboard client={api} userId="user" />)
  const check = await screen.findByRole('button', { name: 'Consultar estado do grupo' })
  vi.mocked(service.loadGroupWorkspace).mockRejectedValueOnce(new ApiError(503))
  await user.click(check)
  expect(await screen.findByText(/Não foi possível verificar os grupos/)).toBeInTheDocument()
  vi.mocked(service.loadGroupWorkspace).mockResolvedValue({ groups: [other], players: [otherPlayer] })
  await user.click(screen.getByRole('button', { name: 'Consultar estado do grupo' }))
  expect(await screen.findByRole('heading', { name: 'Domingo' })).toBeInTheDocument()
  expect(screen.getByText('Bia')).toBeInTheDocument()
  expect(screen.queryByText('Ana')).not.toBeInTheDocument()
  expect(screen.getByText(/Não foi possível confirmar se foi excluído/)).toBeInTheDocument()
  expect(deleteGroup).toHaveBeenCalledExactlyOnceWith(group.id)
})

it('aguarda o salvamento em Ajustes, então bloqueia exclusão até conferir a resposta incerta', async () => {
  const user = userEvent.setup()
  let rejectSave!: (error: unknown) => void
  vi.mocked(service.updateGroup).mockImplementation(() => new Promise((_, reject) => { rejectSave = reject }))
  const deleteGroup = vi.fn()
  render(<GroupDashboard client={{ ...client, deleteGroup }} userId="user" />)
  await user.click(await screen.findByRole('button', { name: 'Ajustar grupo' }))
  await user.click(screen.getByRole('button', { name: 'Salvar grupo' }))
  expect(screen.getByRole('button', { name: 'Excluir grupo' })).toBeDisabled()
  await act(() => { rejectSave(new ApiError(503)); return Promise.resolve() })
  expect(screen.getByRole('button', { name: 'Excluir grupo' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Conferir salvamento' }))
  expect(screen.getByRole('button', { name: 'Excluir grupo' })).toBeEnabled()
  expect(deleteGroup).not.toHaveBeenCalled()
})

it('fecha a confirmação se a sessão suspender e não envia exclusão quando offline', async () => {
  const user = userEvent.setup()
  const deleteGroup = vi.fn()
  const api = { ...client, deleteGroup }
  const workspace = (suspended: boolean) => <ConfirmationSuspended.Provider value={suspended}>
    <GroupDashboard client={api} userId="user" />
  </ConfirmationSuspended.Provider>
  const view = render(workspace(false))
  await user.click(await screen.findByRole('button', { name: 'Ajustar grupo' }))
  await user.click(screen.getByRole('button', { name: 'Excluir grupo' }))
  await user.type(screen.getByLabelText('Digite EXCLUIR'), 'EXCLUIR')
  view.rerender(workspace(true))
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  view.rerender(workspace(false))
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  await user.click(screen.getByRole('button', { name: 'Excluir grupo' }))
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(deleteGroup).not.toHaveBeenCalled()
})

afterEach(() => vi.restoreAllMocks())

it('criar grupo também permite cancelar a troca e mantém a partida digitada', async () => {
  const user = userEvent.setup()
  const view = render(<GroupDashboard client={client} userId="user" />)
  // Wait for the real lazy match module before querying its form under parallel load.
  await act(async () => { await vi.dynamicImportSettled() })
  await user.type(await screen.findByLabelText(/Nome.*opcional/), 'Continuar aqui')
  await user.click(screen.getByRole('button', { name: 'Novo grupo' }))
  await user.type(screen.getByLabelText('Nome', { exact: true }), 'Novo destino')
  vi.mocked(service.createGroup).mockResolvedValue('b')
  vi.mocked(service.loadGroupWorkspace).mockResolvedValue({ groups: [group, { ...group, id: 'b', name: 'Novo destino' }], players: [player] })
  await user.click(screen.getByRole('button', { name: 'Salvar grupo' }))
  await user.click(await screen.findByRole('button', { name: 'Continuar editando' }))
  await screen.findByRole('button', { name: 'Novo destino' })
  expect(screen.getByRole('heading', { name: 'Quarta' })).toBeInTheDocument()
  expect(screen.getByLabelText(/Nome.*opcional/)).toHaveValue('Continuar aqui')
  view.unmount()
})

it('cancelar logout preserva o rascunho; confirmar encerra e recarga dispara aviso antes de sair', async () => {
  const user = userEvent.setup(), onLogout = vi.fn().mockResolvedValue(undefined)
  render(<MemoryRouter><FutebolWorkspace onLogout={onLogout} loggingOut={false} access="active"
    workspace={{ services: client, internalId: 'user', data: { groups: [group], players: [player] } }}
    sessionActions={null} environment="dev" /></MemoryRouter>)
  await user.type(await screen.findByLabelText(/Nome.*opcional/), 'Não perder')
  const unload = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(unload)
  expect(unload.defaultPrevented).toBe(true)
  await user.click(screen.getByRole('button', { name: 'Sair' }))
  await user.click(screen.getByRole('button', { name: 'Continuar editando' }))
  expect(onLogout).not.toHaveBeenCalled()
  expect(screen.getByLabelText(/Nome.*opcional/)).toHaveValue('Não perder')
  await user.click(screen.getByRole('button', { name: 'Sair' }))
  await user.click(screen.getByRole('button', { name: 'Descartar e sair' }))
  expect(onLogout).toHaveBeenCalledOnce()
})

it('restaura o último grupo válido após recarga e ignora preferência de outro usuário ou grupo removido', async () => {
  const user = userEvent.setup()
  const groups = [group, { ...group, id: 'b', name: 'Outro grupo' }]
  vi.mocked(service.loadGroupWorkspace).mockResolvedValue({ groups, players: [player] })
  let view = render(<GroupDashboard client={client} userId="user" />)
  await user.click(await screen.findByRole('button', { name: 'Outro grupo' }))
  expect(screen.getByRole('heading', { name: 'Outro grupo' })).toBeInTheDocument()
  view.unmount()
  view = render(<GroupDashboard client={client} userId="user" />)
  expect(await screen.findByRole('heading', { name: 'Outro grupo' })).toBeInTheDocument()
  view.rerender(<GroupDashboard client={client} userId="other-user" />)
  expect(screen.queryByRole('heading', { name: 'Outro grupo' })).not.toBeInTheDocument()
  expect(await screen.findByRole('heading', { name: 'Quarta' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Outro grupo' }))
  view.unmount()
  vi.mocked(service.loadGroupWorkspace).mockResolvedValue({ groups: [group], players: [player] })
  render(<GroupDashboard client={client} userId="other-user" />)
  expect(await screen.findByRole('heading', { name: 'Quarta' })).toBeInTheDocument()
})

it('cancela troca de grupo preservando formulário ainda não enviado, seleção e ajustes do rascunho', async () => {
  const user = userEvent.setup()
  vi.mocked(service.loadGroupWorkspace).mockResolvedValue({ groups: [group, { ...group, id: 'b', name: 'Outro grupo' }], players: [player, { ...player, id: 'p2', name: 'Bia' }] })
  render(<GroupDashboard client={client} userId="user" />)
  await user.type(await screen.findByLabelText(/Nome.*opcional/), 'Rascunho protegido')
  await user.click(screen.getByRole('button', { name: 'Outro grupo' }))
  await user.click(screen.getByRole('button', { name: 'Continuar editando' }))
  expect(screen.getByLabelText(/Nome.*opcional/)).toHaveValue('Rascunho protegido')
  await user.click(screen.getByRole('button', { name: 'Selecionar participantes' }))
  await user.click(screen.getByRole('button', { name: 'Selecionar todos' }))
  await user.click(screen.getByRole('button', { name: 'Outro grupo' }))
  await user.click(screen.getByRole('button', { name: 'Continuar editando' }))
  expect(screen.getAllByRole('checkbox').every(input => (input as HTMLInputElement).checked)).toBe(true)
  await user.click(screen.getByRole('button', { name: 'Sortear times' }))
  const region = await screen.findByRole('region', { name: 'Resultado do sorteio' })
  await user.click(within(region).getAllByRole('button', { name: /^Selecionar para ajuste/ })[0]!)
  await user.click(within(region).getAllByRole('button', { name: 'Trocar com selecionado' })[0]!)
  const adjusted = region.textContent
  await user.click(screen.getByRole('button', { name: 'Outro grupo' }))
  expect(screen.getByRole('alertdialog')).toHaveTextContent('alterações não salvas')
  await user.click(screen.getByRole('button', { name: 'Continuar editando' }))
  expect(region.textContent).toBe(adjusted)
  await user.click(screen.getByRole('button', { name: 'Outro grupo' }))
  await user.click(screen.getByRole('button', { name: 'Descartar e trocar de grupo' }))
  expect(await screen.findByRole('heading', { name: 'Outro grupo' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Quarta' }))
  expect(screen.getByLabelText(/Nome.*opcional/)).toHaveValue('')
  expect(matches.saveMatchDraw).not.toHaveBeenCalled()
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
  expect(screen.queryByRole('button', { name: /^Editar / }) !== null).toBe(role === 'admin')
})

it('troca o formulário de jogador sem reutilizar os dados anteriores e permite desativar', async () => {
  const user = userEvent.setup()
  vi.mocked(service.loadGroupWorkspace).mockResolvedValue({ groups: [group], players: [player, { ...player, id: 'p2', name: 'Bia' }] })
  render(<GroupDashboard client={client} userId="user" />)
  await screen.findByText('Ana')
  await user.click(within(screen.getByText('Ana').closest('li')!).getByRole('button', { name: /^Editar / }))
  expect(screen.getByLabelText('Nome')).toHaveValue('Ana')
  await user.click(within(screen.getByText('Bia').closest('li')!).getByRole('button', { name: /^Editar / }))
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
  await user.click(await screen.findByRole('button', { name: 'Novo grupo' }))
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
  await user.click(within(roster).getAllByRole('button', { name: /^Editar / })[0]!)
  await user.click(screen.getByRole('button', { name: 'Salvar jogador' }))
  expect(await screen.findByRole('button', { name: 'Tentar salvar novamente' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: 'Tentar salvar novamente' }))
  await screen.findByText(/Partida salva e sorteio aceito/)
  expect(screen.getByRole('button', { name: 'Outro grupo' })).toBeEnabled()
  expect(vi.mocked(matches.saveMatchDraw).mock.calls[1]![1]).toBe(first[1])
  expect(vi.mocked(matches.saveMatchDraw).mock.calls[1]![2]).toBe(first[2])
})
