import { useState, type DragEventHandler, type ReactNode } from 'react'

/** Native disclosure keeps teams keyboard accessible without hiding their summary. */
export function TeamCard({ name, summary, children, onDragOver, onDrop }: { name: string; summary: string; children: ReactNode; onDragOver?: DragEventHandler<HTMLElement>; onDrop?: DragEventHandler<HTMLElement> }) {
  const [open, setOpen] = useState(() => !window.matchMedia?.('(max-width: 599px)').matches)
  return <article className="draw-team" onDragOver={onDragOver} onDrop={onDrop}>
    <details className="team-disclosure" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary><h3>{name}</h3><span className="team-card-meta">{summary}</span><span className="disclosure-hint" aria-hidden="true">{open ? 'Recolher' : 'Ver escalação'}</span></summary>
      <div className="team-card-body">{children}</div>
    </details>
  </article>
}
