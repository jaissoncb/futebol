import { useCallback, useEffect, useRef, useState } from 'react'

export interface ConfirmationRequest {
  title: string
  message: string
  action: string
  cancel?: string
}

/** A cancelled/unmounted confirmation never authorizes the pending action. */
export function useConfirmation() {
  const [request, setRequest] = useState<ConfirmationRequest | null>(null)
  const resolver = useRef<((decision: boolean) => void) | null>(null)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false; resolver.current?.(false); resolver.current = null } }, [])
  const confirm = useCallback((next: ConfirmationRequest) => {
    if (!alive.current || resolver.current) return Promise.resolve(false)
    return new Promise<boolean>(resolve => { resolver.current = resolve; setRequest(next) })
  }, [])
  const onDecision = useCallback((decision: boolean) => {
    const resolve = resolver.current
    resolver.current = null
    setRequest(null)
    resolve?.(decision)
  }, [])
  return { confirm, dialogProps: { request, onDecision } }
}
