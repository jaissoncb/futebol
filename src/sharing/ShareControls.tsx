import { useEffect, useRef, useState } from 'react'
import { copyMatchText } from '../matches/share-result'
import type { PublicLineup } from './contracts'
import { DRAW_TITLE, drawMessage } from './lineup'
import { drawImage } from './draw-image'

function supportsFiles(data: ShareData) {
  try { return typeof navigator.share === 'function' && navigator.canShare?.(data) === true }
  catch { return false }
}

export function ShareControls({ snapshot, link }: { snapshot: PublicLineup; link: string }) {
  const text = drawMessage(snapshot, link)
  const [file, setFile] = useState<File | null>(null)
  const [imageError, setImageError] = useState(false)
  const [imageAttempt, setImageAttempt] = useState(0)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const sharing = useRef(false)
  useEffect(() => {
    let current = true
    void drawImage(snapshot, link).then(image => {
      if (current) setFile(image)
    }, () => {
      if (current) setImageError(true)
    })
    return () => { current = false }
  }, [snapshot, link, imageAttempt])

  const fileOnly = file ? { files: [file] } : null
  const fileAndLink = file ? { files: [file], url: link } : null
  const combined = file ? { files: [file], text } : null
  async function share(data: ShareData) {
    if (sharing.current) return
    sharing.current = true
    setBusy(true); setNotice('')
    try {
      await navigator.share(data)
      setNotice('Opções de compartilhamento abertas.')
    } catch (error) {
      setNotice(error instanceof Error && error.name === 'AbortError'
        ? 'Compartilhamento cancelado.'
        : 'Não foi possível abrir o compartilhamento. Você pode copiar o conteúdo ou salvar a imagem.')
    } finally {
      sharing.current = false
      setBusy(false)
    }
  }

  async function copy(value: string, label: string) {
    try { await copyMatchText(value); setNotice(`${label} copiado para a área de transferência.`) }
    catch { setNotice('Não foi possível copiar automaticamente. Selecione o conteúdo e copie manualmente.') }
  }

  function download() {
    if (!file) return
    const url = URL.createObjectURL(file)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = file.name
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const canShareLink = typeof navigator.share === 'function'
  const canShareImageLink = fileAndLink && supportsFiles(fileAndLink)
  const canShareCombined = combined && supportsFiles(combined)
  const canShareImage = fileOnly && supportsFiles(fileOnly)
  return <div className="publication-share">
    <div className="share-actions">
      <a className="solid-action" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">Texto e link no WhatsApp</a>
      <a className="quiet-action" href={`https://wa.me/?text=${encodeURIComponent(link)}`} target="_blank" rel="noopener noreferrer">Só o link no WhatsApp</a>
      {canShareLink && <button className="quiet-action" disabled={busy} onClick={() => void share({ title: DRAW_TITLE, url: link })}>Compartilhar link</button>}
      {canShareLink && <button className="quiet-action" disabled={busy} onClick={() => void share({ title: DRAW_TITLE, text })}>Compartilhar texto e link</button>}
      {canShareImageLink && <button className="quiet-action" disabled={busy} onClick={() => void share(fileAndLink)}>Compartilhar imagem e link</button>}
      {canShareCombined && <button className="quiet-action" disabled={busy} onClick={() => void share(combined)}>Compartilhar imagem, texto e link</button>}
      {canShareImage && !canShareCombined && <button className="quiet-action" disabled={busy} onClick={() => void share(fileOnly)}>Compartilhar só a imagem</button>}
      <button className="quiet-action" onClick={() => void copy(text, 'Conteúdo')}>Copiar mensagem</button>
      <button className="quiet-action" onClick={() => void copy(link, 'Link')}>Copiar link</button>
      <button className="quiet-action" disabled={!file} onClick={download}>Salvar imagem</button>
    </div>
    {file && <p className="share-note">{canShareCombined
      ? 'Se a conversa receber só a imagem, cole a mensagem ou o link também.'
      : 'Para enviar a imagem com a mensagem, salve a imagem e cole a mensagem na conversa.'}</p>}
    {imageError && <p role="alert">Não foi possível gerar a imagem. <button className="quiet-action" onClick={() => { setImageError(false); setImageAttempt(value => value + 1) }}>Tentar novamente</button></p>}
    <details className="share-message">
      <summary>Ver mensagem e link</summary>
      <textarea aria-label="Mensagem para copiar" rows={6} value={text} readOnly />
      <a href={link} rel="noreferrer">{link}</a>
    </details>
    {notice && <p role="status">{notice}</p>}
  </div>
}
