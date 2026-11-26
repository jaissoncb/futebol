import { useEffect, useId, useRef, useState } from 'react'
import { ApiError } from '../lib/api/client'
import type { FutebolDataClient } from '../lib/data-client'
import type { Disclosure, PublicationAction, PublicationDays, PublicationState } from './contracts'
import { Lineup } from './SharedLineup'
import { applyDisclosure, drawUrl } from './lineup'
import { ShareControls } from './ShareControls'

const defaults: Disclosure = { groupName: false, matchDate: false, goalkeepers: false }
const labels = { private: 'Privado', published: 'Publicado', expired: 'Expirado', revoked: 'Revogado' }
const fields = [
  ['groupName', 'Incluir nome do grupo'],
  ['matchDate', 'Incluir data da partida'],
  ['goalkeepers', 'Identificar goleiros'],
] as const

export function DrawPublication({ client, groupId, matchId }: { client: FutebolDataClient; groupId: string; matchId: string }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  return <div className="draw-publication">
    <button className="solid-action" type="button" aria-expanded={open} aria-controls={panelId}
      onClick={() => setOpen(value => !value)}>{open ? 'Fechar compartilhamento público' : 'Compartilhar sorteio'}</button>
    <div id={panelId}>
      {open && <PublicationPanel client={client} groupId={groupId} matchId={matchId} />}
    </div>
  </div>
}

function PublicationPanel({ client, groupId, matchId }: { client: FutebolDataClient; groupId: string; matchId: string }) {
  const [state, setState] = useState<PublicationState | null>(null)
  const [options, setOptions] = useState(defaults)
  const [days, setDays] = useState<PublicationDays>(30)
  const [replace, setReplace] = useState(false)
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [refreshRequired, setRefreshRequired] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const writing = useRef(false)
  useEffect(() => {
    let current = true
    void Promise.resolve().then(() => client.drawPublication(groupId, matchId)).then(result => {
      if (!current) return
      setState(result); setOptions(result.options ?? defaults); setRefreshRequired(false)
    }, () => {
      if (current) setError('Não foi possível consultar o compartilhamento deste sorteio.')
    })
    return () => { current = false }
  }, [client, groupId, matchId, revision])

  function refresh() {
    setState(null); setError(''); setNotice(''); setReplace(false); setRevision(value => value + 1)
  }

  async function update(action: PublicationAction) {
    if (!state || writing.current || refreshRequired) return
    writing.current = true
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await client.updateDrawPublication(groupId, matchId, {
        action, version: state.version, revision: state.revision, options, days,
      })
      setState(result); setOptions(result.options ?? defaults); setReplace(false)
      setNotice(action === 'revoke' ? 'Link revogado.' : action === 'renew' ? 'Validade renovada.' : 'Sorteio publicado. Escolha como compartilhar.')
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 422) {
        setError('Um nome contém dados de contato. Desmarque o nome do grupo se for o caso. Para corrigir os nomes salvos dos jogadores, salve um novo sorteio com os nomes de exibição corrigidos.')
      } else {
        setRefreshRequired(true)
        setError('Atualize o estado antes de tentar novamente. A publicação pode ter mudado.')
      }
    } finally {
      writing.current = false
      setBusy(false)
    }
  }

  if (!state) return <div className="publication-panel" aria-label="Publicação do sorteio">
    {error ? <><p role="alert">{error}</p><button className="quiet-action" onClick={refresh}>Tentar novamente</button></>
      : <p role="status">Consultando publicação…</p>}
  </div>

  const { publication } = state
  const optionsChanged = fields.some(([key]) => state.options?.[key] !== options[key])
  const preparing = !publication || optionsChanged || state.changed || replace
  const preview = preparing ? applyDisclosure(state.preview, options) : publication.snapshot

  return <section className="publication-panel" aria-label="Publicação do sorteio" aria-busy={busy}>
    <div className="publication-heading"><h3>Publicação do sorteio</h3><strong>{labels[state.status]}</strong></div>
    {publication && <p>Válido até <time dateTime={publication.expiresAt}>{new Date(publication.expiresAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</time></p>}
    <p className="share-note">Qualquer pessoa com o link pode consultar e encaminhar a escalação. Use apenas nomes de exibição ou apelidos que possam ser divulgados.</p>
    {state.changed && <p className="notice">Existe uma versão pública anterior. Publique novamente para divulgar a escalação corrigida e invalidar o link anterior.</p>}
    <fieldset disabled={busy || refreshRequired} className="publication-fields">
      <legend>Informações a divulgar</legend>
      {fields.map(([key, label]) => <label key={key}>
        <input type="checkbox" checked={options[key]} onChange={event => setOptions({ ...options, [key]: event.target.checked })} /> {label}
      </label>)}
      <label className="publication-duration">Validade <select value={days}
        onChange={event => setDays(Number(event.target.value) as PublicationDays)}>
        <option value={7}>7 dias</option><option value={30}>30 dias</option><option value={90}>90 dias</option>
      </select></label>
    </fieldset>
    {preparing && <div className="publication-preview">
      <h4>Prévia da publicação</h4>
      <Lineup snapshot={preview} headingLevel={5} />
      {publication && !state.changed && <p className="share-note">Ao publicar esta versão, o endereço anterior deixará de funcionar.</p>}
    </div>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!refreshRequired && <div className="share-actions publication-management">
      {preparing && <button className="solid-action" disabled={busy} onClick={() => void update(replace && publication ? 'replace' : 'publish')}>Publicar e compartilhar</button>}
      {publication && !preparing && <>
        <button className="quiet-action" disabled={busy} onClick={() => void update('renew')}>Estender validade</button>
        <button className="quiet-action" disabled={busy} onClick={() => setReplace(true)}>Substituir endereço</button>
      </>}
      {replace && <button className="quiet-action" disabled={busy} onClick={() => setReplace(false)}>Cancelar substituição</button>}
      {publication && <button className="quiet-action" disabled={busy} onClick={() => void update('revoke')}>Revogar link</button>}
    </div>}
    {refreshRequired && <button className="quiet-action" onClick={refresh}>Atualizar publicação</button>}
    {publication && !refreshRequired && <div className="publication-current">
      <p className="share-note">Revogar impede novas consultas ao site. Quem recebeu a mensagem ou a imagem pode conservar uma cópia.</p>
      <h4>{preparing ? 'Compartilhar a versão anterior' : 'Compartilhar a versão publicada'}</h4>
      <a className="quiet-action" href={drawUrl(publication.slug)} target="_blank" rel="noopener noreferrer">Abrir publicação</a>
      <ShareControls key={publication.slug} snapshot={publication.snapshot} link={drawUrl(publication.slug)} />
    </div>}
  </section>
}
