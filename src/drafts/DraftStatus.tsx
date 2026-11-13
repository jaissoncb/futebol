import type { DraftStatus } from './use-draft'

const DRAFT_MESSAGES = {
  unavailable: 'O armazenamento local está indisponível. Suas alterações podem se perder ao fechar ou recarregar.',
  quota: 'O dispositivo está sem espaço para guardar o rascunho. Libere espaço e tente novamente.',
  version: 'Este rascunho foi guardado em uma versão incompatível. Abra uma versão atualizada do Futebol.',
  corrupt: 'O rascunho contém dados inválidos e não pode ser recuperado.',
  conflict: 'Outra aba alterou este rascunho. Suas alterações nesta aba não substituíram a revisão mais recente.',
  revoked: 'A conta ou a permissão deste rascunho mudou. Atualize sua sessão para continuar.',
} as const

export function DraftStatusMessage({ status, onReload }: { status: DraftStatus; onReload?: () => void }) {
  if (status === 'idle') return null
  if (status === 'saving' || status === 'saved') {
    return <p className="game-flow-note" role="status">{status === 'saved' ? 'Rascunho guardado neste dispositivo.' : 'Guardando rascunho…'}</p>
  }
  return <div className="form-status"><p role="alert">{DRAFT_MESSAGES[status]}</p>
    {status === 'conflict' && onReload && <button type="button" className="quiet-action" onClick={onReload}>Abrir revisão mais recente</button>}
  </div>
}

export function DraftReadError({ issue, onRetry, onDiscard }: {
  issue: keyof typeof DRAFT_MESSAGES; onRetry: () => void; onDiscard: () => void
}) {
  return <div className="notice"><DraftStatusMessage status={issue} />
    <button type="button" className="quiet-action" onClick={onRetry}>Tentar abrir rascunho novamente</button>
    {issue === 'corrupt' && <button type="button" className="quiet-action" onClick={onDiscard}>Descartar rascunho inválido</button>}
  </div>
}
