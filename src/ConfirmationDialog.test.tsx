import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmationDialog } from './ConfirmationDialog'
import { useConfirmation } from './useConfirmation'

function Harness({ decide }: { decide: (answer: boolean) => void }) {
  const { confirm, dialogProps } = useConfirmation()
  return <><button onClick={() => { void confirm({ title: 'Descartar rascunho?', message: 'As alterações ainda não foram salvas.', action: 'Descartar' }).then(decide) }}>Abrir confirmação</button><ConfirmationDialog {...dialogProps} /></>
}

it('foca a opção segura, Enter cancela e devolve foco ao acionador', async () => {
  const user = userEvent.setup(), decide = vi.fn()
  render(<Harness decide={decide} />)
  const opener = screen.getByRole('button', { name: 'Abrir confirmação' })
  await user.click(opener)
  expect(screen.getByRole('alertdialog', { name: 'Descartar rascunho?' })).toHaveAccessibleDescription('As alterações ainda não foram salvas.')
  expect(screen.getByRole('button', { name: 'Continuar editando' })).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(decide).toHaveBeenCalledExactlyOnceWith(false)
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(opener).toHaveFocus()
})

it('autoriza somente a escolha explícita; cancelamento nativo do elemento equivale a preservar', async () => {
  const user = userEvent.setup(), decide = vi.fn()
  render(<Harness decide={decide} />)
  await user.click(screen.getByRole('button', { name: 'Abrir confirmação' }))
  fireEvent(screen.getByRole('alertdialog'), new Event('cancel', { cancelable: true }))
  await act(async () => { await Promise.resolve() })
  expect(decide).toHaveBeenLastCalledWith(false)
  await user.click(screen.getByRole('button', { name: 'Abrir confirmação' }))
  await user.click(screen.getByRole('button', { name: 'Descartar' }))
  expect(decide).toHaveBeenLastCalledWith(true)
})

it('desmontar a tela cancela a ação pendente', async () => {
  const user = userEvent.setup(), decide = vi.fn()
  const view = render(<Harness decide={decide} />)
  await user.click(screen.getByRole('button', { name: 'Abrir confirmação' }))
  view.unmount()
  await act(async () => { await Promise.resolve() })
  expect(decide).toHaveBeenCalledExactlyOnceWith(false)
})
