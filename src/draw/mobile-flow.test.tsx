import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GameFlow } from './GameFlow'
import { TeamCard } from './TeamCard'
import { group, players } from '../matches/test-fixtures'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('seleção por busca mantém jogadores fora do filtro e só desmarca os encontrados', async () => {
  const user = userEvent.setup()
  render(<GameFlow group={group} players={players} />)
  await user.click(screen.getByRole('button', { name: 'Selecionar participantes' }))
  await user.click(screen.getByRole('button', { name: 'Selecionar todos' }))
  const search = screen.getByRole('searchbox', { name: 'Buscar participantes' })
  await user.click(search); await user.paste('Pessoa 2')
  expect(screen.getByText(/4 jogadores selecionados/)).toBeInTheDocument()
  expect(screen.getAllByRole('checkbox')).toHaveLength(1)
  await user.click(screen.getByRole('button', { name: 'Desmarcar encontrados' }))
  expect(screen.getByText(/3 jogadores selecionados/)).toBeInTheDocument()
  await user.clear(search)
  expect(screen.getAllByRole('checkbox').filter(box => (box as HTMLInputElement).checked)).toHaveLength(3)
})

it('time móvel inicia recolhido e abre pelo resumo nativo', async () => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
  const user = userEvent.setup()
  render(<TeamCard name="Time Azul" summary="2 jogadores"><p>Escalação fictícia</p></TeamCard>)
  const summary = screen.getByText('Time Azul').closest('summary')!
  expect(summary.parentElement).not.toHaveAttribute('open')
  await user.click(summary)
  expect(summary.parentElement).toHaveAttribute('open')
})
