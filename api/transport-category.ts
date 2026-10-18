export type TransportCategory = 'dns' | 'tls' | 'connect' | 'reset' | 'timeout' | 'transport'

// Never return error text, address, URL, request headers or arbitrary provider codes.
export function transportCategory(error: unknown): TransportCategory {
  const pending: unknown[] = [error]
  const seen = new Set<unknown>()
  for (let i = 0; i < pending.length && i < 16; i++) {
    const item = pending[i]
    if (!item || typeof item !== 'object' || seen.has(item)) continue
    seen.add(item)
    if ('name' in item && item.name === 'TimeoutError') return 'timeout'
    const code = 'code' in item ? item.code : undefined
    if (['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL'].includes(String(code))) return 'dns'
    if (['CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN',
      'DEPTH_ZERO_SELF_SIGNED_CERT', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(String(code))) return 'tls'
    if (['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(String(code))) return 'timeout'
    if (['ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH'].includes(String(code))) return 'connect'
    if (['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET'].includes(String(code))) return 'reset'
    if ('cause' in item) pending.push(item.cause)
    if ('errors' in item && Array.isArray(item.errors)) {
      const nested: unknown[] = item.errors
      pending.push(...nested.slice(0, 8))
    }
  }
  return 'transport'
}
