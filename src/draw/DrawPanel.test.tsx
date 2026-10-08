import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DrawPanel } from './DrawPanel'
import { localDateInputValue } from './local-date'
import type { GroupWithRole, Player } from '../groups/group-service'

const group: GroupWithRole = { id: 'a', name: 'Grupo', role: 'owner', sport: 'futsal', default_players_on_court: 5, created_by: 'user', created_at: '', updated_at: '' }
const players: Player[] = Array.from({ length: 14 }, (_, i) => ({ id: `p${i}`, group_id: 'a', name: `Pessoa ${i}`, nickname: null, skill_rating: 3, is_goalkeeper: i < 3, active: true, preferred_position: null, created_at: '', updated_at: '' }))

describe('fluxo de jogo das Fases 5 e 6', () => {
  afterEach(() => vi.restoreAllMocks())

  async function openParticipants(user: ReturnType<typeof userEvent.setup>, options: { teamCount?: '2' | '3'; name?: string } = {}) {
    render(<DrawPanel group={group} players={players} />)
    if (options.name) await user.type(screen.getByLabelText(/Nome/), options.name)
    if (options.teamCount) await user.selectOptions(screen.getByLabelText('Times'), options.teamCount)
    await user.click(screen.getByRole('button', { name: 'Selecionar participantes' }))
  }

  it('limita o fluxo a owner/admin', () => {
    render(<DrawPanel group={{ ...group, role: 'member' }} players={players} />)
    expect(screen.queryByRole('region', { name: 'Novo jogo' })).not.toBeInTheDocument()
  })

  it('configura jogo, filtra elegíveis e mostra resultado 5/5/4 com aviso e goleiros', async () => {
    const user = userEvent.setup()
    render(<DrawPanel group={group} players={[...players, { ...players[0]!, id: 'inactive', active: false }, { ...players[0]!, id: 'other', group_id: 'b' }]} />)
    await user.type(screen.getByLabelText(/Nome/), 'Futebol quinta')
    await user.selectOptions(screen.getByLabelText('Times'), '3')
    await user.click(screen.getByRole('button', { name: 'Selecionar participantes' }))
    expect(screen.getByText('3 times · 5 em quadra por time')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Selecionar todos' }))
    expect(screen.getByText('14 jogadores selecionados')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sortear times' }))
    const result = await screen.findByRole('region', { name: 'Resultado do sorteio' })
    expect(within(result).getByRole('heading', { name: 'Futebol quinta' })).toBeInTheDocument()
    expect(within(result).getAllByRole('article')).toHaveLength(3)
    expect(within(result).getAllByRole('listitem')).toHaveLength(14)
    expect(within(result).getByText(/precisa de 1 jogador/)).toBeInTheDocument()
    expect(within(result).getAllByText(/Goleiro/).length).toBeGreaterThan(0)
  })

  it('mantém dados para voltar e editar participantes ou configuração', async () => {
    const user = userEvent.setup()
    await openParticipants(user)
    await user.click(screen.getByRole('button', { name: 'Selecionar todos' }))
    await user.click(screen.getByRole('button', { name: 'Sortear times' }))
    await screen.findByRole('region', { name: 'Resultado do sorteio' })
    await user.click(screen.getByRole('button', { name: 'Voltar aos participantes' }))
    expect(screen.getByText('14 jogadores selecionados')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(screen.getByRole('heading', { name: 'Configure a partida' })).toBeInTheDocument()
    expect(screen.getByText(/existe apenas nesta tela/)).toBeInTheDocument()
  })

  it('mostra estado vazio e trata falha de aleatoriedade sem detalhe técnico', async () => {
    const user = userEvent.setup()
    const empty = render(<DrawPanel group={group} players={[]} />)
    await user.click(screen.getByRole('button', { name: 'Selecionar participantes' }))
    expect(screen.getByText(/Nenhum jogador ativo disponível/)).toBeInTheDocument()
    empty.unmount()

    vi.spyOn(crypto, 'getRandomValues').mockImplementationOnce(() => { throw new Error('private detail') })
    await openParticipants(user)
    await user.click(screen.getByRole('button', { name: 'Selecionar todos' }))
    await user.click(screen.getByRole('button', { name: 'Sortear times' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível sortear')
    expect(screen.queryByText('private detail')).not.toBeInTheDocument()
  })

  it('permite troca acessível entre times e marca o resultado como ajustado', async () => {
    const user = userEvent.setup()
    await openParticipants(user)
    await user.click(screen.getByRole('button', { name: 'Selecionar todos' }))
    await user.click(screen.getByRole('button', { name: 'Sortear times' }))
    const result = await screen.findByRole('region', { name: 'Resultado do sorteio' })
    const selectButtons = within(result).getAllByRole('button', { name: 'Selecionar para ajuste' })
    await user.click(selectButtons[0]!)
    await user.click(within(result).getAllByRole('button', { name: 'Trocar com selecionado' })[0]!)
    expect(within(result).getByText(/Ajustado manualmente/)).toBeInTheDocument()
    expect(within(result).getByRole('status')).toHaveTextContent('Ajuste aplicado')
    expect(within(result).queryByRole('button', { name: 'Cancelar ajuste' })).not.toBeInTheDocument()
    expect(within(result).getAllByRole('listitem')).toHaveLength(14)
  })

  it('troca titular por reserva no próprio time sem criar reserva externa', async () => {
    const user = userEvent.setup()
    render(<DrawPanel group={group} players={players.slice(0, 12)} />)
    await user.click(screen.getByRole('button', { name: 'Selecionar participantes' }))
    await user.click(screen.getByRole('button', { name: 'Selecionar todos' }))
    await user.click(screen.getByRole('button', { name: 'Sortear times' }))
    const result = await screen.findByRole('region', { name: 'Resultado do sorteio' })
    const team = within(result).getAllByRole('article')[0]!
    const reserve = within(team).getByRole('region', { name: /Reservas do Time/ })
    const starter = within(team).getByRole('region', { name: /Em quadra do Time/ })
    await user.click(within(reserve).getByRole('button', { name: 'Selecionar para ajuste' }))
    const outfieldStarter = within(starter).getAllByRole('listitem').find((item) => !within(item).queryByText(/Goleiro/))!
    await user.click(within(outfieldStarter).getByRole('button', { name: 'Trocar titular/reserva' }))
    expect(within(within(team).getByRole('region', { name: /Reservas do Time/ })).getAllByRole('listitem')).toHaveLength(1)
    expect(within(within(team).getByRole('region', { name: /Em quadra do Time/ })).getAllByRole('listitem')).toHaveLength(5)
  })

  it('confirma reroll após ajuste e descarta a indicação de ajuste manual', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await openParticipants(user)
    await user.click(screen.getByRole('button', { name: 'Selecionar todos' }))
    await user.click(screen.getByRole('button', { name: 'Sortear times' }))
    const result = await screen.findByRole('region', { name: 'Resultado do sorteio' })
    await user.click(within(result).getAllByRole('button', { name: 'Selecionar para ajuste' })[0]!)
    await user.click(within(result).getAllByRole('button', { name: 'Trocar com selecionado' })[0]!)
    await user.click(within(result).getByRole('button', { name: 'Novo sorteio' }))
    expect(confirm).toHaveBeenCalledOnce()
    expect(await screen.findByText(/Diferença entre médias:/)).toBeInTheDocument()
    expect(screen.queryByText(/Ajustado manualmente/)).not.toBeInTheDocument()
    expect(within(result).queryByRole('button', { name: 'Cancelar ajuste' })).not.toBeInTheDocument()
  })

  it('formata a data inicial a partir dos campos locais, sem UTC', () => {
    const date = new Date(0)
    date.setFullYear(2026, 0, 2)
    date.setHours(0, 30, 0, 0)
    expect(localDateInputValue(date)).toBe('2026-01-02')
  })
})
