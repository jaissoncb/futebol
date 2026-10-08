import { Component, type PropsWithChildren } from 'react'

/** A missing/offline feature chunk must leave the roster and navigation usable. */
export class MatchModuleBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed ? <section className="panel compact-panel" role="alert">
      <p>Não foi possível abrir as partidas. Confira a conexão e recarregue o aplicativo.</p>
      <button className="quiet-action" type="button" onClick={() => window.location.reload()}>Recarregar aplicativo</button>
    </section> : this.props.children
  }
}
