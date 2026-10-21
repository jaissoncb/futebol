import { useEffect, useId, useRef, useState } from 'react'
import type { GroupWithRole } from './group-service'

export function GroupSwitcher({ groups, selectedId, disabled, onSelect }: {
  groups: GroupWithRole[]; selectedId: string | null; disabled: boolean; onSelect: (id: string) => void
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const id = useId()
  const [edges, setEdges] = useState({ overflow: false, previous: false, next: false })
  function measure() {
    const element = viewport.current
    if (!element) return
    const next = { overflow: element.scrollWidth > element.clientWidth + 2,
      previous: element.scrollLeft > 2, next: element.scrollLeft + element.clientWidth < element.scrollWidth - 2 }
    setEdges(current => current.overflow === next.overflow && current.previous === next.previous && current.next === next.next ? current : next)
  }
  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const frame = requestAnimationFrame(measure)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(element)
    window.addEventListener('resize', measure)
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [groups])
  function scroll(direction: number) {
    const element = viewport.current
    if (!element) return
    element.scrollBy({ left: direction * Math.max(120, element.clientWidth * 0.8),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }
  return <div className="group-navigation" role="group" aria-label="Grupos">
    {groups.length > 1 ? <div className="group-navigation-hint"><span>{groups.length} grupos</span>
      {edges.overflow ? <span>Use as setas ou deslize</span> : null}</div> : null}
    <div className="group-navigation-row">
      {edges.overflow ? <button className="group-scroll-action" type="button" aria-label="Ver grupos anteriores" aria-controls={id}
        disabled={disabled || !edges.previous} onClick={() => scroll(-1)}><span aria-hidden="true">‹</span></button> : null}
      <div className="group-switcher" id={id} ref={viewport} onScroll={measure}>
        {groups.map(group => <button aria-pressed={group.id === selectedId} disabled={disabled}
          className={group.id === selectedId ? 'group-chip selected' : 'group-chip'} key={group.id} title={group.name}
          onClick={event => { onSelect(group.id); event.currentTarget.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }) }} type="button">
          <span>{group.name}</span>
        </button>)}
      </div>
      {edges.overflow ? <button className="group-scroll-action" type="button" aria-label="Ver próximos grupos" aria-controls={id}
        disabled={disabled || !edges.next} onClick={() => scroll(1)}><span aria-hidden="true">›</span></button> : null}
    </div>
  </div>
}
