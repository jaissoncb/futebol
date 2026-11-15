import { useState } from 'react'
import type { Player } from '../groups/group-service'
import type { GameConfig } from './draw-payload'
import { copyMatchText, participantListText, shareMatchText } from './share-result'

export function ShareParticipants({ config, players }: { config: GameConfig; players: Player[] }) {
  const [notice, setNotice] = useState('')
  const text = participantListText(config, players)
  async function send(copy: boolean) {
    setNotice('')
    try {
      if (copy) {
        await copyMatchText(text)
        setNotice('Lista copiada.')
      } else {
        const result = await shareMatchText(config.name.trim() || 'Partida de futebol', text)
        if (result === 'copied') setNotice('Lista copiada para compartilhamento.')
        if (result === 'shared') setNotice('Lista compartilhada.')
      }
    } catch {
      setNotice('Não foi possível copiar ou compartilhar. Selecione o texto da lista para copiar manualmente.')
    }
  }
  return <details>
    <summary>Lista para compartilhar</summary>
    <div className="data-form">
      <label>Lista da partida<textarea readOnly value={text} rows={6} /></label>
      <div className="draw-actions">
        <button className="quiet-action" type="button" onClick={() => void send(true)}>Copiar lista</button>
        {typeof navigator.share === 'function' ? <button className="quiet-action" type="button" onClick={() => void send(false)}>Compartilhar lista</button> : null}
      </div>
      {notice ? <p role="status">{notice}</p> : null}
    </div>
  </details>
}
