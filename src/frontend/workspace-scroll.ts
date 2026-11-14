import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { GroupWorkspaceData } from '../groups/group-service'
import { readSelectedGroup } from '../groups/selected-group'

const KEY = 'futebol.workspace-scroll.v1'
type Position = { path: string; profile: string; group: string; role: string; y: number }

export function clearWorkspaceScroll() {
  try { sessionStorage.removeItem(KEY) } catch { /* Storage is optional. */ }
}

function readPosition(): Position | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as Position | null
    return value && typeof value.profile === 'string' && typeof value.path === 'string'
      && typeof value.group === 'string' && typeof value.role === 'string'
      && Number.isFinite(value.y) && value.y >= 0 ? value : null
  } catch { return null }
}

export function useWorkspaceScroll(content: RefObject<HTMLDivElement | null>, active: boolean, profile: string | undefined, data: GroupWorkspaceData | undefined, path: string) {
  const [height, setHeight] = useState(0)
  const [initialPosition] = useState(readPosition)
  const position = useRef(initialPosition)
  const wasActive = useRef(false)
  const restore = useRef(false)

  useLayoutEffect(() => {
    if (!active) {
      if (wasActive.current) restore.current = true
      wasActive.current = false
      return
    }
    const element = content.current
    if (!element || !profile || !data) return
    const initial = !wasActive.current
    wasActive.current = true
    if (initial && position.current) restore.current = true

    const measure = () => { setHeight(element.getBoundingClientRect().height) }
    const selected = () => {
      const id = readSelectedGroup(profile)
      return data.groups.find(group => group.id === id)
    }
    const save = () => {
      if (restore.current) return
      const group = selected()
      if (!group) return
      position.current = { path, profile, group: group.id, role: group.role, y: window.scrollY }
      try { sessionStorage.setItem(KEY, JSON.stringify(position.current)) } catch { /* Keep the in-memory position. */ }
    }
    const update = () => {
      const saved = position.current
      if (saved && (saved.path !== path || saved.profile !== profile || !data.groups.some(
        entry => entry.id === saved.group && entry.role === saved.role))) {
        restore.current = false
        position.current = null
        clearWorkspaceScroll()
        window.scrollTo(0, 0)
      }
      measure()
      if (!restore.current || !saved) return
      const group = selected()
      if (group?.id !== saved.group || !element.querySelector('.players-section')) return
      if (element.querySelector('[data-loading-workspace]')) return
      const maxY = document.documentElement.scrollHeight - window.innerHeight
      restore.current = false
      window.scrollTo(0, Math.min(saved.y, Math.max(0, maxY)))
    }
    const frame = window.requestAnimationFrame(update)
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    resize?.observe(element)
    // A late layout must never move the user after they start navigating.
    const cancelRestore = () => { restore.current = false }
    window.addEventListener('wheel', cancelRestore, { passive: true })
    window.addEventListener('touchstart', cancelRestore, { passive: true })
    window.addEventListener('keydown', cancelRestore)
    window.addEventListener('scroll', save, { passive: true })
    window.addEventListener('pagehide', save)
    const hidden = () => { if (document.visibilityState === 'hidden') save() }
    document.addEventListener('visibilitychange', hidden)
    return () => {
      window.cancelAnimationFrame(frame)
      resize?.disconnect()
      window.removeEventListener('wheel', cancelRestore)
      window.removeEventListener('touchstart', cancelRestore)
      window.removeEventListener('keydown', cancelRestore)
      window.removeEventListener('scroll', save)
      window.removeEventListener('pagehide', save)
      document.removeEventListener('visibilitychange', hidden)
    }
  }, [active, content, data, path, profile])

  return height
}
