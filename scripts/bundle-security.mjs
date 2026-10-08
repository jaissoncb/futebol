/** Reject privileged credentials in emitted text; never include a value in errors. */
export function assertPublicBundle(text) {
  if (/sb_secret_[a-zA-Z0-9_-]{5,}/.test(text)) throw new Error('Chave privada encontrada no build; publicação bloqueada.')
  if (/service_role[_:-][a-zA-Z0-9_-]{5,}/i.test(text)
    || /(?:key|token|secret)\s*[:=]\s*["'`]service_role["'`]/i.test(text)) {
    throw new Error('Credencial service_role encontrada no build; publicação bloqueada.')
  }
  if (/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|re_[A-Za-z0-9]{25,})\b/.test(text)
    || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)
    || /postgres(?:ql)?:\/\/[^\s:/]+:[^\s@]{8,}@/.test(text)) {
    throw new Error('Padrão de credencial administrativa encontrado no build; publicação bloqueada.')
  }
  for (const token of text.matchAll(/eyJ[a-zA-Z0-9_-]+\.([a-zA-Z0-9_-]+)\.[a-zA-Z0-9_-]+/g)) {
    let payload
    try { payload = JSON.parse(Buffer.from(token[1], 'base64url').toString('utf8')) } catch { continue }
    if (payload && typeof payload === 'object' && 'role' in payload && payload.role !== 'anon') {
      throw new Error('JWT privilegiado encontrado no build; publicação bloqueada.')
    }
  }
}
