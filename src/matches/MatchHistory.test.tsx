import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FutebolSupabaseClient } from '../lib/supabase/client'
import { MatchWorkspace } from './MatchWorkspace'
import * as service from './match-service'
import * as sharing from './share-result'
import { group, players, saved } from './test-fixtures'

vi.mock('./match-service', async (original) => ({ ...await original<typeof service>(), loadMatchHistory: vi.fn(), loadSavedMatch: vi.fn(), saveMatchDraw: vi.fn() }))
vi.mock('./share-result', async (original) => ({ ...await original<typeof sharing>(), shareSavedResult: vi.fn() }))
const client = {} as FutebolSupabaseClient
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(service.loadMatchHistory).mockResolvedValue([saved.match])
  vi.mocked(service.loadSavedMatch).mockResolvedValue(saved)
  vi.mocked(sharing.shareSavedResult).mockResolvedValue('shared')
  vi.mocked(service.saveMatchDraw).mockImplementation((_client, id) => Promise.resolve(id))
})
async function open(user: ReturnType<typeof userEvent.setup>) { await user.click(screen.getByRole('button', { name: 'Abrir histórico' })) }
async function detail(user: ReturnType<typeof userEvent.setup>) {
  await open(user); await user.click(await screen.findByRole('button', { name: /Futebol quinta/ })); return screen.findByRole('heading', { name: 'Futebol quinta' })
}

describe('histórico e detalhe da Fase 7', () => {
  it.each(['member', 'owner', 'admin'] as const)('permite leitura do próprio grupo para %s sem controles de alteração no detalhe', async (role) => {
    const user = userEvent.setup()
    render(<MatchWorkspace client={client} group={{ ...group, role }} players={players.map((p) => ({ ...p, name: 'Nome ATUAL', nickname: 'Atual', skill_rating: 1 }))} />)
    if (role === 'member') expect(screen.queryByRole('region', { name: 'Novo jogo' })).not.toBeInTheDocument()
    await detail(user)
    const region = screen.getByRole('region', { name: 'Partida salva' })
    expect(within(region).getByText(/P1 \(Pessoa 1\).*Nível 3.0/)).toBeInTheDocument()
    expect(within(region).queryByText(/Nome ATUAL/)).not.toBeInTheDocument()
    expect(within(region).queryByRole('button', { name: /Salvar|Excluir|Editar|aceitar/ })).not.toBeInTheDocument()
    expect(service.loadSavedMatch).toHaveBeenCalledWith(client, group.id, saved.match.id)
    expect(within(region).getByText(/Sorteio 1 · Aceito/)).toBeInTheDocument()
    await user.click(within(region).getByRole('button', { name: 'Voltar ao histórico' }))
    expect(await screen.findByRole('button', { name: /Futebol quinta/ })).toBeInTheDocument()
  })
  it('mostra loading, vazio e mantém a ordem retornada pelo serviço', async () => {
    const user = userEvent.setup()
    let resolve!: (rows: typeof saved.match[]) => void
    vi.mocked(service.loadMatchHistory).mockImplementationOnce(() => new Promise((r) => { resolve = r }))
    render(<MatchWorkspace client={client} group={{ ...group, role: 'member' }} players={[]} />)
    await open(user); expect(screen.getByText('Carregando histórico…')).toBeInTheDocument()
    await act(() => { resolve([]); return Promise.resolve() }); expect(await screen.findByText('Nenhuma partida salva neste grupo.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Fechar histórico' }))
    vi.mocked(service.loadMatchHistory).mockResolvedValue([{ ...saved.match, id: 'latest', name: 'Mais recente', match_date: '2026-09-13' }, saved.match])
    await open(user)
    const first = await screen.findByRole('button', { name: /Mais recente/ }), second = screen.getByRole('button', { name: /Futebol quinta/ })
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
  })
  it('recupera erro no histórico e no detalhe sem expor mensagem interna', async () => {
    const user = userEvent.setup()
    vi.mocked(service.loadMatchHistory).mockRejectedValueOnce(new Error('private error'))
    render(<MatchWorkspace client={client} group={{ ...group, role: 'member' }} players={[]} />)
    await open(user); expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar o histórico')
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    vi.mocked(service.loadSavedMatch).mockRejectedValueOnce(new Error('private error'))
    await user.click(await screen.findByRole('button', { name: /Futebol quinta/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar a partida salva')
    expect(screen.queryByText('private error')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(await screen.findByRole('heading', { name: 'Futebol quinta' })).toBeInTheDocument()
  })
  it('pagina sem substituir partidas já carregadas', async () => {
    const user = userEvent.setup()
    vi.mocked(service.loadMatchHistory).mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => ({ ...saved.match, id: `match-${i}`, name: `Histórico ${i}` })))
      .mockResolvedValueOnce([{ ...saved.match, id: 'older', name: 'Partida mais antiga' }])
    render(<MatchWorkspace client={client} group={{ ...group, role: 'member' }} players={[]} />)
    await open(user); await user.click(await screen.findByRole('button', { name: 'Carregar mais partidas' }))
    await screen.findByRole('button', { name: /Partida mais antiga/ })
    expect(screen.getByRole('button', { name: /Histórico 0 / })).toBeInTheDocument()
    expect(service.loadMatchHistory).toHaveBeenLastCalledWith(client, group.id, 1)
    expect(screen.queryByRole('button', { name: 'Carregar mais partidas' })).not.toBeInTheDocument()
  })
  it.each(['shared', 'copied', 'cancelled'] as const)('informa o resultado do compartilhamento: %s', async (outcome) => {
    const user = userEvent.setup()
    vi.mocked(sharing.shareSavedResult).mockResolvedValue(outcome)
    render(<MatchWorkspace client={client} group={{ ...group, role: 'member' }} players={[]} />)
    await detail(user); await user.click(screen.getByRole('button', { name: 'Compartilhar resultado' }))
    const messages = { shared: 'Resultado compartilhado.', copied: 'Resultado copiado para a área de transferência.', cancelled: 'Compartilhamento cancelado.' }
    expect(await screen.findByRole('status')).toHaveTextContent(messages[outcome])
    expect(sharing.shareSavedResult).toHaveBeenCalledWith(saved)
  })
  it('trata erro de compartilhamento e preserva o detalhe', async () => {
    const user = userEvent.setup()
    vi.mocked(sharing.shareSavedResult).mockRejectedValue(new Error('denied'))
    render(<MatchWorkspace client={client} group={{ ...group, role: 'member' }} players={[]} />)
    await detail(user); await user.click(screen.getByRole('button', { name: 'Compartilhar resultado' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Não foi possível compartilhar ou copiar')
    expect(screen.getByRole('heading', { name: 'Futebol quinta' })).toBeInTheDocument()
  })
  it('após salvar abre o detalhe e permite nova partida sem salvar novamente o resultado aceito', async () => {
    const user = userEvent.setup()
    render(<MatchWorkspace client={client} group={group} players={players} />)
    await user.click(screen.getByRole('button', { name: 'Selecionar participantes' }))
    await user.click(screen.getByRole('button', { name: 'Selecionar todos' }))
    await user.click(screen.getByRole('button', { name: 'Sortear times' }))
    await screen.findByRole('region', { name: 'Resultado do sorteio' })
    await user.click(screen.getByRole('button', { name: 'Salvar e aceitar sorteio' }))
    await screen.findByRole('heading', { name: 'Futebol quinta' })
    expect(service.saveMatchDraw).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Salvar e aceitar sorteio' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Criar outra partida' }))
    expect(screen.getByRole('heading', { name: 'Configure a partida' })).toBeInTheDocument()
  })
})
