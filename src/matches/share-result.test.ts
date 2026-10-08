import { savedResultText, shareSavedResult } from './share-result'
import { saved } from './test-fixtures'

describe('compartilhamento textual salvo', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('inclui nome, data, horário, times, titulares/reservas e snapshots', () => {
    const text = savedResultText(saved)
    for (const value of ['Futebol quinta', '12/09/2026 · 20:00', 'Time Azul', 'Time Vermelho', 'Titulares:', 'Reservas:', 'P1']) expect(text).toContain(value)
    expect(text).not.toContain('http')
  })
  it('prioriza Web Share API', async () => {
    const share = vi.fn().mockResolvedValue(undefined), writeText = vi.fn()
    vi.stubGlobal('navigator', { share, clipboard: { writeText } })
    expect(await shareSavedResult(saved)).toBe('shared')
    expect(share).toHaveBeenCalledWith({ title: saved.match.name, text: savedResultText(saved) })
    expect(writeText).not.toHaveBeenCalled()
  })
  it.each([false, true])('copia se Web Share ausente ou falha (%s)', async (fails) => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { share: fails ? vi.fn().mockRejectedValue(new Error('not supported')) : undefined, clipboard: { writeText } })
    expect(await shareSavedResult(saved)).toBe('copied')
    expect(writeText).toHaveBeenCalledWith(savedResultText(saved))
  })
  it('não copia silenciosamente após cancelamento e trata clipboard indisponível/falha', async () => {
    const writeText = vi.fn()
    vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(new DOMException('cancel', 'AbortError')), clipboard: { writeText } })
    expect(await shareSavedResult(saved)).toBe('cancelled'); expect(writeText).not.toHaveBeenCalled()
    vi.stubGlobal('navigator', {})
    await expect(shareSavedResult(saved)).rejects.toThrow('indisponível')
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    await expect(shareSavedResult(saved)).rejects.toThrow('denied')
  })
})
