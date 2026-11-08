import { useId, useLayoutEffect, useRef } from 'react'
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
    onClick={event => { if (event.target === event.currentTarget) onDecision(false) }}>
    <div className="confirmation-content">
      <h2 id={`${id}-title`}>{request.title}</h2>
      <p id={`${id}-message`}>{request.message}</p>
      <div className="confirmation-actions">
        <button ref={cancel} className="confirmation-cancel" type="button" onClick={() => onDecision(false)}>{request.cancel ?? 'Continuar editando'}</button>
        <button className="confirmation-discard" type="button" onClick={() => onDecision(true)}>{request.action}</button>
      </div>
    </div>
  </dialog>, document.body)
}
