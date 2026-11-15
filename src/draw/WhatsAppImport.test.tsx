import { ConfirmationSuspended } from '../useConfirmation'
// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { group, players } from '../matches/test-fixtures'
import { GameFlow } from './GameFlow'

const roster = [
  { ...players[0]!, name: 'Ana', nickname: null },
  { ...players[1]!, name: 'Bento' },
  { ...players[2]!, name: 'Cecília', group_id: 'other-group' },
]

function openReview(text: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Ler lista do WhatsApp' }))
  fireEvent.change(screen.getByLabelText('Cole a lista numerada'), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Revisar lista' }))
  return within(screen.getByRole('dialog'))
}

describe('WhatsApp roster review', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.setAttribute('open', '') } })
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute('open') } })
  })

  it('adds a repeated player once, keeps an absent selection and excludes other groups', async () => {
    render(<GameFlow group={group} players={roster} />)
    await userEvent.click(screen.getByRole('button', { name: 'Selecionar participantes' }))
    await userEvent.click(screen.getByRole('checkbox', { name: /Bento/ }))
    const review = openReview('1 - Ana\n1 - Ana\n3 - Cecília')
    expect(review.getByText(/Duplicidade/)).toBeInTheDocument()
    expect(review.getByText(/Ausentes.*Bento/)).toBeInTheDocument()
    expect(review.getByText('Jogador não encontrado')).toBeInTheDocument()
    expect(review.queryByRole('option', { name: 'Cecília' })).not.toBeInTheDocument()
    await userEvent.click(review.getByRole('button', { name: 'Confirmar 1 entrada(s)' }))
    expect(screen.getByRole('checkbox', { name: /Ana/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Bento/ })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Selecionar participantes' }))
    expect(screen.getByRole('checkbox', { name: /Ana/ })).toBeChecked()
  })

  it('drops unconfirmed review state on cancel and unmount', async () => {
    const view = render(<GameFlow group={group} players={roster} />)
    await userEvent.click(screen.getByRole('button', { name: 'Selecionar participantes' }))
    fireEvent.click(openReview('1 - Ana').getByRole('button', { name: 'Cancelar importação' }))
    expect(screen.getByRole('checkbox', { name: /Ana/ })).not.toBeChecked()
    openReview('1 - Ana')
    view.unmount()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('closes a pending review on suspension and resumes the existing selection', async () => {
    const flow = (suspended: boolean) => <ConfirmationSuspended.Provider value={suspended}>
      <GameFlow group={group} players={roster} />
    </ConfirmationSuspended.Provider>
    const view = render(flow(false))
    await userEvent.click(screen.getByRole('button', { name: 'Selecionar participantes' }))
    await userEvent.click(screen.getByRole('checkbox', { name: /Bento/ }))
    openReview('1 - Ana')
    view.rerender(flow(true))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    view.rerender(flow(false))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Bento/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Ana/ })).not.toBeChecked()
  })
})
