import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DraftError, discardCorruptDraft, draftIssue, readDraft, writeDraft, type DraftIssue, type DraftKind, type DraftScope } from './store'

export type DraftStatus = 'idle' | 'saving' | 'saved' | DraftIssue
type Validator<T> = (value: unknown, groupId: string) => value is T
export type DraftWriter<T> = ReturnType<typeof createWriter<T>>

function createWriter<T>(scope: DraftScope, kind: DraftKind, validate: Validator<T>, revision: number, notify: (status: DraftStatus) => void) {
  let queue = Promise.resolve()
  let timer: ReturnType<typeof setTimeout> | undefined
  let queued: { value: T } | undefined
  let generation = 0

  function commit(value: T | null) {
    clearTimeout(timer)
    queued = undefined
    const current = ++generation
    notify('saving')
    const task = queue.then(async () => {
      if (value !== null && !validate(value, scope.groupId)) throw new DraftError('corrupt')
      revision = await writeDraft(scope, kind, revision, value)
    })
    queue = task.catch(() => undefined)
    return task.then(() => {
      if (current === generation) notify(value === null ? 'idle' : 'saved')
      return true
    }, error => {
      if (current === generation) notify(draftIssue(error))
      return false
    })
  }

  function flush() {
    if (queued) void commit(queued.value)
  }

  return {
    commit, flush,
    schedule(value: T, delay: number) {
      clearTimeout(timer)
      queued = { value }
      generation++
      notify('saving')
      timer = setTimeout(flush, delay)
    },
  }
}

type OpenDraft<T> =
  | { state: 'loading' }
  | { state: 'error'; issue: DraftIssue }
  | { state: 'ready'; initial: T | null; writer?: DraftWriter<T> }

export function useDraftRecord<T>(scope: DraftScope | null | undefined, kind: DraftKind, validate: Validator<T>) {
  const [record, setRecord] = useState<OpenDraft<T>>(scope ? { state: 'loading' } : { state: 'ready', initial: null })
  const [status, setStatus] = useState<DraftStatus>('idle')
  const [load, setLoad] = useState(0)
  const { environment, userId, groupId, epoch, grant } = scope ?? {}
  useEffect(() => {
    if (!environment || !userId || !groupId || !epoch || !grant) return
    const current = { environment, userId, groupId, epoch, grant }
    let active = true
    void readDraft(current, kind, validate).then(snapshot => {
      if (!active) return
      const writer = createWriter(current, kind, validate, snapshot.revision, next => { if (active) setStatus(next) })
      setRecord({ state: 'ready', initial: snapshot.value, writer })
      setStatus(snapshot.value ? 'saved' : 'idle')
    }, error => {
      if (active) setRecord({ state: 'error', issue: draftIssue(error) })
    })
    return () => { active = false }
  }, [environment, userId, groupId, epoch, grant, kind, validate, load])

  function reload() {
    setRecord({ state: 'loading' })
    setLoad(n => n + 1)
  }
  async function discardCorrupt() {
    if (!scope) return
    try { await discardCorruptDraft(scope, kind, validate); reload() }
    catch (error) { setRecord({ state: 'error', issue: draftIssue(error) }) }
  }
  return { record, status, reload, discardCorrupt }
}

/** Layout effects capture committed React state before page lifecycle handlers run. */
export function useDraftAutosave<T>(writer: DraftWriter<T> | undefined, value: T | null, delay: number, initial?: T | null) {
  const signature = value === null || !writer ? null : JSON.stringify(value)
  const last = useRef<string | null>(initial ? JSON.stringify(initial) : null)
  useLayoutEffect(() => {
    if (last.current === signature) return
    last.current = signature
    if (value !== null && signature !== null) writer?.schedule(value, delay)
  }, [writer, value, delay, signature])

  useLayoutEffect(() => {
    if (!writer) return
    const hidden = () => { if (document.visibilityState === 'hidden') writer.flush() }
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('pagehide', writer.flush)
    return () => {
      document.removeEventListener('visibilitychange', hidden)
      window.removeEventListener('pagehide', writer.flush)
      writer.flush()
    }
  }, [writer])
}
