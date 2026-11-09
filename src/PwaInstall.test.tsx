import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PwaInstall, PwaInstallProvider } from './PwaInstall'

function mount() {
  return render(<PwaInstallProvider><PwaInstall /></PwaInstallProvider>)
}

function offer(prompt: () => Promise<{ outcome: string }>) {
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt })
  act(() => { window.dispatchEvent(event) })
  return event
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('instalação do Futebol', () => {
  it.each(['accepted', 'dismissed'])('abre o prompt nativo uma vez e trata %s', async outcome => {
    mount()
    const prompt = vi.fn().mockResolvedValue({ outcome })
    expect(offer(prompt).defaultPrevented).toBe(true)
    expect(prompt).not.toHaveBeenCalled()
    const user = userEvent.setup()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Instalar Futebol' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status')).toHaveTextContent(outcome === 'accepted' ? 'aceito' : 'cancelada')
    expect(screen.getByRole('status')).toHaveFocus()
    expect(offer(prompt).defaultPrevented).toBe(false)
    expect(screen.queryByText('Instalar Futebol')).not.toBeInTheDocument()
  })

  it('oferece instruções manuais quando o prompt falha', async () => {
    mount()
    offer(vi.fn().mockRejectedValue(new Error('unavailable')))
    await userEvent.click(screen.getByRole('button', { name: 'Instalar Futebol' }))
    expect(screen.getByRole('status')).toHaveTextContent('não abriu')
    expect(screen.getByText('Como instalar o Futebol')).toHaveFocus()
  })

  it('retira o convite quando o navegador confirma a instalação', () => {
    mount()
    offer(vi.fn())
    act(() => { window.dispatchEvent(new Event('appinstalled')) })
    expect(screen.getByRole('status')).toHaveTextContent('foi instalado')
    expect(screen.queryByText('Instalar Futebol')).not.toBeInTheDocument()
  })

  it('oculta o convite ao entrar em modo standalone', () => {
    const mode = Object.assign(new EventTarget(), { matches: false })
    vi.stubGlobal('matchMedia', () => mode)
    mount()
    mode.matches = true
    act(() => { mode.dispatchEvent(new Event('change')) })
    expect(screen.queryByText('Como instalar o Futebol')).not.toBeInTheDocument()
    expect(offer(vi.fn()).defaultPrevented).toBe(false)
  })

  it('reconhece o modo standalone legado do Safari', () => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true })
    try {
      mount()
      expect(screen.queryByText('Como instalar o Futebol')).not.toBeInTheDocument()
    } finally {
      Reflect.deleteProperty(navigator, 'standalone')
    }
  })

  it.each(['iPhone', 'iPad', 'iPad em modo desktop'])('mostra instruções do Safari para %s', async device => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(device.includes('desktop') ? 'Macintosh' : device)
    if (device.includes('desktop')) {
      vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
      Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 })
    }
    try {
      mount()
      await userEvent.click(screen.getByText('Como instalar o Futebol'))
      expect(screen.getByText('Compartilhar')).toBeVisible()
      expect(screen.getByText('Abrir como App')).toBeVisible()
      expect(screen.queryByText('Instalar Futebol')).not.toBeInTheDocument()
    } finally {
      if (device.includes('desktop')) Reflect.deleteProperty(navigator, 'maxTouchPoints')
    }
  })

  it('permite focar e alternar o guia genérico sem prompt nativo', async () => {
    mount()
    const user = userEvent.setup()
    const summary = screen.getByText('Como instalar o Futebol')
    expect(summary.closest('details')).not.toHaveAttribute('open')
    await user.tab()
    expect(summary).toHaveFocus()
    await user.click(summary)
    expect(summary.closest('details')).toHaveAttribute('open')
    expect(screen.getByText('Instalar app')).toBeVisible()
    await user.click(summary)
    expect(summary.closest('details')).not.toHaveAttribute('open')
  })
})
