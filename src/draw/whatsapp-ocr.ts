import { createWorker, OEM, PSM } from 'tesseract.js'
import workerPath from 'tesseract.js/dist/worker.min.js?url&no-inline'
import corePath from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url&no-inline'
import languagePath from '@tesseract.js-data/por/4.0.0_best_int/por.traineddata.gz?url&no-inline'

export async function readWhatsAppImages(files: File[], signal: AbortSignal) {
  for (const file of files) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 15_000_000) {
      throw new Error('Imagem inválida')
    }
  }

  signal.throwIfAborted()
  const langPath = new URL('.', new URL(languagePath, window.location.href)).href
  let reportError: (cause: Error) => void = () => {}
  const workerError = new Promise<never>((_, reject) => { reportError = reject })
  const initializing = createWorker('por', OEM.LSTM_ONLY, {
    workerPath,
    corePath,
    langPath,
    workerBlobURL: false,
    cacheMethod: 'none',
    errorHandler: () => reportError(new Error('Falha no motor OCR')),
  })

  let stop: (() => void) | undefined
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined
  try {
    signal.throwIfAborted()
    const cancelled = new Promise<never>((_, reject) => {
      stop = () => reject(new DOMException('Leitura cancelada', 'AbortError'))
      signal.addEventListener('abort', stop, { once: true })
    })
    const ready = await Promise.race([initializing, cancelled, workerError])
    worker = ready
    const recognize = async () => {
      await ready.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK })
      const captures: string[] = []
      for (const file of files) {
        signal.throwIfAborted()
        const { data: result } = await ready.recognize(file)
        captures.push(result.text)
      }
      signal.throwIfAborted()
      return captures
    }
    return await Promise.race([cancelled, workerError, recognize()])
  } finally {
    if (stop) signal.removeEventListener('abort', stop)
    if (worker) await worker.terminate()
    else void initializing.then((lateWorker) => lateWorker.terminate()).catch(() => {})
  }
}
