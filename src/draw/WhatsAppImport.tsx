import { ConfirmationSuspended } from '../useConfirmation'
import { useContext, useLayoutEffect, useRef, useState } from 'react'
import type { Player } from '../groups/group-service'
import { matchWhatsAppName, normalizeName, parseWhatsAppCaptures } from './whatsapp-list'

type Row = { name: string; query: string; choice?: string }

function label(player: Player) {
  return player.nickname ? `${player.name} (${player.nickname})` : player.name
}

type ImportProps = {
  players: Player[]
  selected: string[]
  onApply: (ids: string[]) => void
}

export function WhatsAppImportControl(props: ImportProps & { busy: boolean }) {
  const suspended = useContext(ConfirmationSuspended)
  // A modal dialog escapes an inert ancestor. Unmount it when access is suspended.
  return suspended ? null : <ImportLauncher {...props} />
}

function ImportLauncher({ busy, players, selected, onApply }: ImportProps & { busy: boolean }) {
  const [open, setOpen] = useState(false)
  return <>
    <button className="quiet-action" type="button" disabled={busy} onClick={() => setOpen(true)}>Ler lista do WhatsApp</button>
    {open && <WhatsAppImport players={players} selected={selected} onClose={() => setOpen(false)}
      onApply={(ids) => { setOpen(false); onApply(ids) }} />}
  </>
}

function WhatsAppImport({ players, selected, onApply, onClose }: {
  players: Player[]
  selected: string[]
  onApply: (ids: string[]) => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const processing = useRef<AbortController | null>(null)
  const [text, setText] = useState('')
  const [captures, setCaptures] = useState<string[]>([])
  const [rows, setRows] = useState<Row[] | null>(null)
  const [emptySlots, setEmptySlots] = useState(0)
  const [reading, setReading] = useState(false)
  const [notice, setNotice] = useState('')
  useLayoutEffect(() => {
    const element = dialog.current
    if (!element) return
    const opener = document.activeElement
    element.showModal()
    return () => {
      processing.current?.abort()
      if (element.open) element.close()
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])

  async function read(files: File[]) {
    if (!files.length) return
    processing.current?.abort()
    const controller = new AbortController()
    processing.current = controller
    setReading(true)
    setNotice('')
    try {
      const { readWhatsAppImages } = await import('./whatsapp-ocr')
      const recognized = await readWhatsAppImages(files, controller.signal)
      if (controller.signal.aborted) return
      setCaptures(recognized)
      setNotice(`${files.length} imagem(ns) processada(s). Confira os nomes na revisão.`)
    } catch {
      if (!controller.signal.aborted) {
        setNotice('Não foi possível ler as imagens. Confira os arquivos, tente novamente ou cole o texto da lista.')
      }
    } finally {
      if (!controller.signal.aborted) setReading(false)
    }
  }

  function review() {
    const list = parseWhatsAppCaptures([text, ...captures])
    if (!list.names.length) {
      setNotice('Nenhum nome encontrado. Use uma lista numerada, como “1 - Ana”.')
      return
    }
    setRows(list.names.map((name) => ({ name, query: '' })))
    setEmptySlots(list.emptySlots)
    setNotice('')
  }

  function edit(index: number, value: Partial<Row>) {
    setRows((previous) => previous?.map((row, i) => i === index ? { ...row, ...value } : row) ?? null)
  }

  const reviewed = rows?.map((row) => {
    const match = matchWhatsAppName(row.name, players)
    const id = row.choice ?? match.safeId
    return { row, match, id: players.some((player) => player.id === id) ? id : '' }
  }) ?? []
  const ids = reviewed.map(({ id }) => id)
  const newIds = [...new Set(ids.filter((id) => id && !selected.includes(id)))]
  const absent = players.filter((player) => selected.includes(player.id) && !ids.includes(player.id))

  return <dialog ref={dialog} className="whatsapp-import" aria-labelledby="whatsapp-title"
    onCancel={(event) => { event.preventDefault(); onClose() }}>
    <h3 id="whatsapp-title">Ler lista do WhatsApp</h3>
    {rows === null ? <div className="data-form">
      <label>Cole a lista numerada<textarea value={text} onChange={(event) => setText(event.target.value)} rows={6} /></label>
      <p>As capturas são lidas neste dispositivo. Inclua o cabeçalho “Espera” se a captura contiver essa seção.</p>
      <label>Ou selecione capturas da lista<input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => {
        void read(Array.from(event.target.files ?? []))
        event.target.value = ''
      }} /></label>
      {captures.length ? <button type="button" className="quiet-action" disabled={reading} onClick={() => {
        setCaptures([])
        setNotice('')
      }}>Descartar texto das imagens</button> : null}
      {reading ? <p role="status">Lendo as imagens neste dispositivo…</p> : null}
      <button type="button" className="solid-action" disabled={reading || (!text.trim() && !captures.length)} onClick={review}>Revisar lista</button>
    </div> : <>
      <p>{rows.length} nomes · {emptySlots} vagas em aberto na captura com mais vagas</p>
      <p>Convidados precisam estar no elenco ativo. Para incluir um convidado, cadastre-o no elenco ou ignore a linha nesta revisão.</p>
      <ol className="whatsapp-rows">{reviewed.map(({ row, match, id }, index) => {
        const normalized = normalizeName(row.name)
        const duplicate = Boolean(normalized && rows.some((other, i) => i < index && normalizeName(other.name) === normalized)) ||
          Boolean(id && ids.indexOf(id) < index)
        const options = row.query.trim()
          ? players.filter((player) => normalizeName(label(player)).includes(normalizeName(row.query)))
          : [...match.possible, ...players.filter((player) => !match.possible.includes(player))]
        const chosen = players.find((player) => player.id === id)
        const status = row.choice === '' ? 'Ignorado' : id
          ? (selected.includes(id) ? 'Já selecionado' : 'Entrada') + (row.choice ? ' · Escolha manual' : ' · Correspondência segura')
          : match.possible.length ? 'Correspondência possível' : 'Jogador não encontrado'
        return <li key={index} className="data-form">
          <label>Nome {index + 1}<input value={row.name} onChange={(event) => edit(index, { name: event.target.value, query: '', choice: undefined })} /></label>
          <p>{status}{duplicate ? ' · Duplicidade na lista' : ''}</p>
          <label>Buscar no elenco<input type="search" value={row.query} onChange={(event) => edit(index, { query: event.target.value })} /></label>
          <label>Jogador para o nome {index + 1}<select value={row.choice === '' ? 'ignore' : id} onChange={(event) => edit(index, { choice: event.target.value === 'ignore' ? '' : event.target.value || undefined })}>
            <option value="">Usar correspondência segura</option>
            <option value="ignore">Ignorar linha</option>
            {chosen && !options.includes(chosen) ? <option value={id}>{label(chosen)}</option> : null}
            {options.map((player) => <option key={player.id} value={player.id}>{label(player)}</option>)}
          </select></label>
        </li>
      })}</ol>
      {absent.length ? <p>Ausentes na nova lista e mantidos na partida: {absent.map(label).join(', ')}.</p> : null}
      <div className="draw-actions">
        <button type="button" className="quiet-action" onClick={() => { setRows(null); setNotice('') }}>Voltar à lista</button>
        <button type="button" className="solid-action" onClick={() => onApply(newIds)}>
          {newIds.length ? `Confirmar ${newIds.length} entrada(s)` : 'Concluir revisão'}
        </button>
      </div>
    </>}
    {notice ? <p role="status">{notice}</p> : null}
    <button type="button" className="quiet-action" onClick={onClose}>Cancelar importação</button>
  </dialog>
}
