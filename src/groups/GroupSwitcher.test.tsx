import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { GroupSwitcher } from './GroupSwitcher'
import type { GroupWithRole } from './group-service'

const longName = 'Grupo com nome comprido que permanece completo para leitura e seleção'
const groups = ['Quinta', longName, 'Sábado'].map((name, index) => ({ id: String(index), name } as GroupWithRole))

afterEach(() => vi.unstubAllGlobals())

function overflow() {
  const element = screen.getByRole('group', { name: 'Grupos' }).querySelector('.group-switcher')!
  Object.defineProperties(element, { clientWidth: { value: 240, configurable: true },
    scrollWidth: { value: 800, configurable: true }, scrollLeft: { value: 0, writable: true, configurable: true } })
  const scrollBy = vi.fn()
  Object.defineProperty(element, 'scrollBy', { value: scrollBy })
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  fireEvent(window, new Event('resize'))
  return { element, scrollBy }
}

it('permite alcançar grupos nas duas direções sem mudar a seleção ao rolar', async () => {
  const select = vi.fn()
  render(<GroupSwitcher groups={groups} selectedId="0" disabled={false} onSelect={select} />)
  const { element, scrollBy } = overflow()
  const previous = screen.getByRole('button', { name: 'Ver grupos anteriores' })
  const next = screen.getByRole('button', { name: 'Ver próximos grupos' })
  expect(previous).toBeDisabled(); expect(next).toBeEnabled()
  await userEvent.setup().click(next)
  expect(scrollBy).toHaveBeenCalledWith({ left: 192, behavior: 'auto' })
  expect(select).not.toHaveBeenCalled()
  element.scrollLeft = 560; fireEvent.scroll(element)
  expect(next).toBeDisabled(); expect(previous).toBeEnabled()
  await userEvent.setup().click(previous)
  expect(scrollBy).toHaveBeenLastCalledWith({ left: -192, behavior: 'auto' })
})

it('mantém nomes completos e respeita o bloqueio de navegação existente', async () => {
  const select = vi.fn()
  const view = render(<GroupSwitcher groups={groups} selectedId="1" disabled={false} onSelect={select} />)
  overflow()
  const group = screen.getByRole('button', { name: longName })
  expect(group).toHaveAttribute('title', longName)
  expect(group).toHaveAttribute('aria-pressed', 'true')
  await userEvent.setup().click(group)
  expect(select).toHaveBeenCalledWith('1')
  view.rerender(<GroupSwitcher groups={groups} selectedId="1" disabled onSelect={select} />)
  expect(group).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Ver próximos grupos' })).toBeDisabled()
})
