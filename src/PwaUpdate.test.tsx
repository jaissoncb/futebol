import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PwaUpdate } from './PwaUpdate'

const { update, control } = vi.hoisted(() => ({ update: vi.fn<() => Promise<void>>(), control: { changed: () => {} } }))
vi.mock('virtual:pwa-register', () => ({ registerSW: ({ onNeedRefresh, onNeedReload }: { onNeedRefresh: () => void; onNeedReload: () => void }) => { control.changed = onNeedReload; onNeedRefresh(); return update } }))
beforeEach(() => { vi.stubEnv('PROD', true); update.mockReset().mockResolvedValue(undefined) })
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

it('bloqueia atualização com dados pendentes e atualiza diretamente quando liberada, sem popup', async () => {
  const user = userEvent.setup(), native = vi.spyOn(window, 'confirm')
  const view = render(<PwaUpdate pending />)
  const button = await screen.findByRole('button', { name: 'Atualizar aplicativo' })
  expect(button).toBeDisabled()
  await user.click(button)
  expect(update).not.toHaveBeenCalled()
  view.rerender(<PwaUpdate pending={false} />)
  await user.click(button)
  expect(update).toHaveBeenCalledExactlyOnceWith(true)
  expect(native).not.toHaveBeenCalled()
})

it('impede atualização duplicada e oferece retry após falha', async () => {
  let reject!: (reason: Error) => void
  update.mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail }))
  const user = userEvent.setup()
  render(<PwaUpdate pending={false} />)
  await user.dblClick(await screen.findByRole('button', { name: 'Atualizar aplicativo' }))
  expect(update).toHaveBeenCalledOnce()
  expect(screen.getByRole('button', { name: 'Atualizando…' })).toBeDisabled()
  await act(async () => { reject(new Error('fixture')); await Promise.resolve() })
  expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível atualizar')
  await user.click(screen.getByRole('button', { name: 'Atualizar aplicativo' }))
  expect(update).toHaveBeenCalledTimes(2)
})

it('mantém o rascunho quando o worker assume o controle após pedido local', async () => {
  const user = userEvent.setup()
  const view = render(<PwaUpdate pending={false} />)
  const button = await screen.findByRole('button', { name: 'Atualizar aplicativo' })
  await user.click(button)
  expect(update).toHaveBeenCalledOnce()
  view.rerender(<PwaUpdate pending />)
  act(() => control.changed())
  expect(button).toBeDisabled()
  expect(screen.getByRole('status')).toHaveTextContent('Salve seus dados')
})