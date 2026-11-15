import { afterEach, expect, it, vi } from 'vitest'

vi.mock('tesseract.js', () => ({
  createWorker: vi.fn(),
  OEM: { LSTM_ONLY: 1 },
  PSM: { SINGLE_BLOCK: '6' },
}))

import { createWorker } from 'tesseract.js'
import { readWhatsAppImages } from './whatsapp-ocr'

const image = new File(['fixture'], 'list.png', { type: 'image/png' })

function mockWorker() {
  const worker = { recognize: vi.fn(), setParameters: vi.fn(), terminate: vi.fn() }
  vi.mocked(createWorker).mockResolvedValue(worker as unknown as Awaited<ReturnType<typeof createWorker>>)
  return worker
}

afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals() })

it('recognizes overlapping captures with one worker and closes it', async () => {
  const worker = mockWorker()
  worker.recognize.mockResolvedValueOnce({ data: { text: '1 - Ana\n2 - Bento' } })
    .mockResolvedValueOnce({ data: { text: '2 - Bento\n3 - Carla' } })
  expect(await readWhatsAppImages([image, image], new AbortController().signal)).toEqual([
    '1 - Ana\n2 - Bento', '2 - Bento\n3 - Carla',
  ])
  expect(createWorker).toHaveBeenCalledOnce()
  expect(worker.terminate).toHaveBeenCalledOnce()
})

it('rejects invalid images before loading assets and releases the worker on OCR failure', async () => {
  const worker = mockWorker()
  const signal = new AbortController().signal
  await expect(readWhatsAppImages([new File([], 'list.txt', { type: 'text/plain' })], signal)).rejects.toThrow('Imagem inválida')
  expect(createWorker).not.toHaveBeenCalled()
  worker.recognize.mockRejectedValue(new Error('Decoding failed'))
  await expect(readWhatsAppImages([image], signal)).rejects.toThrow('Decoding failed')
  expect(worker.terminate).toHaveBeenCalledOnce()
})

it('terminates recognition after cancellation', async () => {
  const controller = new AbortController()
  const worker = mockWorker()
  worker.recognize.mockImplementation(() => {
    controller.abort()
    return new Promise(() => {})
  })
  await expect(readWhatsAppImages([image, image], controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  expect(worker.recognize).toHaveBeenCalledOnce()
  expect(worker.terminate).toHaveBeenCalledOnce()
})
