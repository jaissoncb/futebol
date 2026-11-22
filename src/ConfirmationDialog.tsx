import { useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ConfirmationRequest } from './useConfirmation'

/** In-page modal: native dialog semantics, no browser JavaScript popup. */
export function ConfirmationDialog({ request, onDecision }: { request: ConfirmationRequest | null; onDecision: (decision: boolean) => void }) {
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    if (!request || !dialog.current) return
    const opener = document.activeElement
    const element = dialog.current
    if (typeof element.showModal === 'function') element.showModal()
    else element.setAttribute('open', '')
    cancel.current?.focus()
    return () => {
      if (typeof element.close === 'function' && element.open) element.close()
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true })
    }
  }, [request])
  if (!request) return null
  return createPortal(<dialog ref={dialog} className="confirmation-dialog" role="alertdialog"
    aria-labelledby={`${id}-title`} aria-describedby={`${id}-message`}
    onCancel={event => { event.preventDefault(); onDecision(false) }}
    onClose={() => onDecision(false)}
    onClick={event => { if (event.target === event.currentTarget) onDecision(false) }}>
    <div className="confirmation-content">
      <h2 id={`${id}-title`}>{request.title}</h2>
      <p id={`${id}-message`}>{request.message}</p>
      <ConfirmationActions request={request} onDecision={onDecision} cancel={cancel} />
    </div>
  </dialog>, document.body)
}

function ConfirmationActions({ request, onDecision, cancel }: {
  request: ConfirmationRequest; onDecision: (decision: boolean) => void
  cancel: React.RefObject<HTMLButtonElement | null>
}) {
  const [text, setText] = useState('')
  const allowed = !request.phrase || text === request.phrase
  return <>
    {request.phrase && <label className="confirmation-phrase">Digite {request.phrase}
      <input value={text} onChange={event => setText(event.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} />
    </label>}
    <div className="confirmation-actions">
      <button ref={cancel} className="confirmation-cancel" type="button" onClick={() => onDecision(false)}>{request.cancel ?? 'Continuar editando'}</button>
      <button className="confirmation-discard" type="button" disabled={!allowed} onClick={() => { if (allowed) onDecision(true) }}>{request.action}</button>
    </div>
  </>
}
