import { useState } from 'react'
import type { Player } from '../groups/group-service'
import { TEAM_NAMES } from '../matches/draw-payload'
import { RULE_LIMIT, describeRule, ruleAvailable, ruleKey, type DrawRule } from './draw-rules'

const LABELS = { together: 'Jogar juntos', apart: 'Jogar separados', fixed: 'Fixar em um time' } as const

export function RulesEditor({ rules, players, teamCount, busy, onChange }: {
  rules: DrawRule[]
  players: Player[]
  teamCount: number
  busy: boolean
  onChange: (rules: DrawRule[]) => Promise<boolean>
}) {
  const [editing, setEditing] = useState(false)
  const [kind, setKind] = useState<DrawRule['kind']>('together')
  const [first, setFirst] = useState('')
  const [target, setTarget] = useState('')
  const names = new Map(players.map(player => [player.id, player.name]))
  const ids = new Set(names.keys())
  const name = (id: string) => names.get(id) ?? 'Jogador indisponível'
  const canAdd = !busy && rules.length < RULE_LIMIT && players.length > 0
  const rule: DrawRule = kind === 'fixed'
    ? { kind, player: first, team: target === '' ? -1 : Number(target) }
    : { kind, player: first, other: target }
  const duplicate = rules.some(existing => ruleKey(existing) === ruleKey(rule))

  async function addRule() {
    if (!await onChange([...rules, rule])) return
    setEditing(false); setFirst(''); setTarget('')
  }

  return <fieldset className="data-form draw-rules" disabled={busy}>
    <legend>Regras do sorteio</legend>
    <p className="game-flow-note">Opcionais e válidas neste rascunho. O histórico guarda a escalação final.</p>
    {rules.length > 0 && <ul>{rules.map(existing => {
      const key = ruleKey(existing)
      const description = describeRule(existing, name, TEAM_NAMES)
      return <li key={key}>
        <p>{description}{ruleAvailable(existing, ids, teamCount) ? '' : ' · Indisponível. Remova esta regra para sortear.'}</p>
        <button className="quiet-action" type="button" aria-label={`Remover regra: ${description}`}
          onClick={() => void onChange(rules.filter(item => ruleKey(item) !== key))}>Remover</button>
      </li>
    })}</ul>}
    {!editing && <button className="quiet-action" type="button" disabled={!canAdd} onClick={() => setEditing(true)}>Adicionar regra</button>}
    {editing && <>
      <label>Tipo de regra<select value={kind} onChange={event => { setKind(event.target.value as DrawRule['kind']); setTarget('') }}>
        {Object.entries(LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>Primeiro jogador<select value={first} onChange={event => {
        setFirst(event.target.value)
        if (kind !== 'fixed' && target === event.target.value) setTarget('')
      }}>
        <option value="">Selecione um jogador</option>
        {players.map(player => <option key={player.id} value={player.id}>{player.name}</option>)}
      </select></label>
      <label>{kind === 'fixed' ? 'Time fixo' : 'Segundo jogador'}
        <select key={kind === 'fixed' ? 'team' : 'player'} value={target} onChange={event => setTarget(event.target.value)}>
          <option value="">{kind === 'fixed' ? 'Selecione um time' : 'Selecione um jogador'}</option>
          {kind === 'fixed' ? TEAM_NAMES.slice(0, teamCount).map((label, index) =>
            <option key={label} value={index}>Time {label}</option>) : players.filter(player => player.id !== first).map(player =>
            <option key={player.id} value={player.id}>{player.name}</option>)}
        </select>
      </label>
      {duplicate && <p role="status">Esta regra já está ativa.</p>}
      <div className="draw-actions">
        <button className="solid-action" type="button" disabled={!canAdd || duplicate || !ruleAvailable(rule, ids, teamCount)}
          onClick={() => void addRule()}>Ativar regra</button>
        <button className="quiet-action" type="button" onClick={() => setEditing(false)}>Cancelar regra</button>
      </div>
    </>}
    {rules.length >= RULE_LIMIT && <p role="status">Limite de {RULE_LIMIT} regras atingido.</p>}
  </fieldset>
}
