import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { HashRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { useAuth } from './auth/auth-context'
import type { BootstrapContext } from './bootstrap/auth-pkce'
import { GroupDashboard } from './groups/GroupDashboard'
import { PwaUpdate } from './PwaUpdate'

interface AppProps {
  bootstrap: BootstrapContext
}

export function AppRoutes({ bootstrap }: AppProps) {
  const { session } = useAuth()
  const [attempt, setAttempt] = useState<{ userId: string; pending: boolean } | null>(null)
  const pending = attempt?.userId === session?.user.id && !!attempt?.pending
  const userId = session?.user.id ?? ''
  const onAttemptChange = useCallback((pending: boolean) => {
    setAttempt((current) => current?.userId === userId && current.pending === pending ? current : { userId, pending })
  }, [userId])
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => { if (pending && location.pathname !== '/') void navigate('/', { replace: true }) }, [pending, location.pathname, navigate])
  return (
    <><PwaUpdate pending={pending} /><Routes location={pending ? '/' : location}>
      <Route path="/" element={<HomePage bootstrap={bootstrap} attemptPending={pending} onAttemptChange={onAttemptChange} />} />
      <Route path="/login" element={<LoginPage message={bootstrap.message} />} />
      <Route path="/cadastro" element={<SignUpPage />} />
      <Route path="/esqueci-senha" element={<RecoveryPage />} />
      <Route path="/nova-senha" element={<NewPasswordPage />} />
      <Route path="/conta" element={<AccountPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes></>
  )
}

export function App({ bootstrap }: AppProps) {
  return (
    <AuthProvider client={bootstrap.client} initialSession={bootstrap.session}>
      <HashRouter>
        <AppRoutes bootstrap={bootstrap} />
      </HashRouter>
    </AuthProvider>
  )
}

function HomePage({ bootstrap, onAttemptChange, attemptPending }: AppProps & { attemptPending: boolean; onAttemptChange: (pending: boolean) => void }) {
  const { session } = useAuth()

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#/" aria-label="Futebol - início">
          <span className="brand-mark" aria-hidden="true">⚽</span>
          <span>Futebol</span>
        </a>
        {session ? <Link className="topbar-link" to="/conta" onClick={(event) => { if (attemptPending) event.preventDefault() }} aria-disabled={attemptPending}>Conta</Link> : <Link className="topbar-link" to="/login">Entrar</Link>}
      </header>

      <main className="main-content">
        {bootstrap.message ? (
          <p className="notice" role="status">{bootstrap.message}</p>
        ) : null}

        {session ? (
          <GroupDashboard key={session.user.id} client={bootstrap.client} userId={session.user.id} onAttemptChange={onAttemptChange} />
        ) : (
          <>
            <section className="hero-card" aria-labelledby="hero-title">
              <p className="eyebrow">Seu jogo, sem complicação</p>
              <h1 id="hero-title">Times equilibrados em poucos toques.</h1>
              <p className="hero-copy">
                Selecione quem chegou, escolha dois ou três times e deixe o sorteio cuidar do resto.
              </p>
            <Link className="primary-action" to="/login">
              Entrar para começar <span aria-hidden="true">→</span>
            </Link>
              <p className="helper-text">Salve as partidas e consulte os times no histórico do seu grupo.</p>
            </section>

            <section className="foundation" aria-labelledby="foundation-title">
              <div>
                <p className="eyebrow">Futebol entre amigos</p>
                <h2 id="foundation-title">Rápida, instalável e feita para celular.</h2>
              </div>
              <ul className="feature-list">
                <li><span aria-hidden="true">✓</span> Elenco organizado por grupo</li>
                <li><span aria-hidden="true">✓</span> Dois ou três times equilibrados</li>
                <li><span aria-hidden="true">✓</span> Histórico e compartilhamento dos times</li>
              </ul>
            </section>
          </>
        )}
      </main>

      <footer className="footer">Sabará · Futebol entre amigos</footer>
    </div>
  )
}

function LoginPage({ message }: { message: string | null }) {
  const { session, signIn } = useAuth()
  const navigate = useNavigate()
  const [status, setStatus] = useState<string | null>(message)
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)

  if (session) return <Navigate to="/" replace />

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    submitting.current = true
    setStatus(null)
    setBusy(true)
    const form = new FormData(event.currentTarget)
    const result = await signIn(readFormString(form, 'email'), readFormString(form, 'password'))
    setBusy(false)
    submitting.current = false
    setStatus(result.error)
    if (!result.error) void navigate('/')
  }

  return (
    <AuthPage title="Entre na sua conta" description="Use o e-mail e a senha cadastrados.">
      <form className="auth-form" onSubmit={(event) => void handleSubmit(event)}>
        <EmailField />
        <PasswordField autoComplete="current-password" />
        <FormStatus message={status} />
        <SubmitButton busy={busy}>Entrar</SubmitButton>
      </form>
      <div className="auth-links">
        <Link to="/esqueci-senha">Esqueci minha senha</Link>
        <Link to="/cadastro">Criar uma conta</Link>
      </div>
    </AuthPage>
  )
}

function SignUpPage() {
  const { session, signUp } = useAuth()
  const [status, setStatus] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)

  if (session) return <Navigate to="/" replace />

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    submitting.current = true
    setStatus(null)
    setBusy(true)
    const form = new FormData(event.currentTarget)
    const result = await signUp({
      displayName: readFormString(form, 'displayName'),
      email: readFormString(form, 'email'),
      password: readFormString(form, 'password'),
    })
    setBusy(false)
    submitting.current = false
    setStatus(result.error)
    setSuccess(!result.error)
  }

  return (
    <AuthPage title="Crie sua conta" description="Cadastre seus dados para organizar o futebol com os amigos.">
      <form className="auth-form" onSubmit={(event) => void handleSubmit(event)}>
        <label>Nome<input name="displayName" autoComplete="name" minLength={2} maxLength={80} required /></label>
        <EmailField />
        <PasswordField autoComplete="new-password" />
        <FormStatus message={success ? 'Cadastro recebido. Confira seu e-mail para continuar.' : status} success={success} />
        <SubmitButton busy={busy}>Criar conta</SubmitButton>
      </form>
      <div className="auth-links"><Link to="/login">Já tenho uma conta</Link></div>
    </AuthPage>
  )
}

function RecoveryPage() {
  const { sendPasswordRecovery } = useAuth()
  const [status, setStatus] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    submitting.current = true
    setStatus(null)
    setBusy(true)
    const form = new FormData(event.currentTarget)
    const result = await sendPasswordRecovery(readFormString(form, 'email'))
    setBusy(false)
    submitting.current = false
    setStatus(result.error)
    setSuccess(!result.error)
  }

  return (
    <AuthPage title="Recupere sua senha" description="Enviaremos um link seguro para o seu e-mail.">
      <form className="auth-form" onSubmit={(event) => void handleSubmit(event)}>
        <EmailField />
        <FormStatus message={success ? 'Se houver uma conta para este e-mail, o link será enviado.' : status} success={success} />
        <SubmitButton busy={busy}>Enviar link</SubmitButton>
      </form>
      <div className="auth-links"><Link to="/login">Voltar para entrar</Link></div>
    </AuthPage>
  )
}

function NewPasswordPage() {
  const { session, updatePassword } = useAuth()
  const navigate = useNavigate()
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    submitting.current = true
    setStatus(null)
    setBusy(true)
    const form = new FormData(event.currentTarget)
    const result = await updatePassword(readFormString(form, 'password'))
    setBusy(false)
    submitting.current = false
    setStatus(result.error)
    if (!result.error) void navigate('/conta')
  }

  return (
    <AuthPage title="Defina uma nova senha" description="Escolha uma senha com pelo menos 8 caracteres.">
      {session ? (
        <form className="auth-form" onSubmit={(event) => void handleSubmit(event)}>
          <PasswordField autoComplete="new-password" />
          <FormStatus message={status} />
          <SubmitButton busy={busy}>Salvar nova senha</SubmitButton>
        </form>
      ) : (
        <FormStatus message="Abra novamente o link de recuperação enviado ao seu e-mail." />
      )}
    </AuthPage>
  )
}

function AccountPage() {
  const { session, signOut } = useAuth()
  const navigate = useNavigate()
  const [status, setStatus] = useState<string | null>(null)

  const signingOut = useRef(false)
  if (!session) return <Navigate to="/login" replace />
  async function handleSignOut() {
    if (signingOut.current) return
    signingOut.current = true
    const result = await signOut()
    signingOut.current = false
    setStatus(result.error)
    if (!result.error) void navigate('/login')
  }

  return (
    <AuthPage title="Sua conta" description={session.user.email ?? 'Conta autenticada'}>
      <FormStatus message={status} />
      <button className="secondary-action" type="button" onClick={() => void handleSignOut()}>Sair deste dispositivo</button>
    </AuthPage>
  )
}

function AuthPage({ children, description, title }: { children: ReactNode; description: string; title: string }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [title])
  return (
    <main className="auth-page">
      <Link className="brand" to="/" aria-label="Futebol - início"><span className="brand-mark" aria-hidden="true">⚽</span><span>Futebol</span></Link>
      <section className="auth-card">
        <h1 ref={heading} tabIndex={-1}>{title}</h1>
        <p>{description}</p>
        {children}
      </section>
    </main>
  )
}

function EmailField() {
  return <label>E-mail<input name="email" type="email" autoComplete="email" required /></label>
}

function PasswordField({ autoComplete }: { autoComplete: 'current-password' | 'new-password' }) {
  return <label>Senha<input name="password" type="password" autoComplete={autoComplete} minLength={8} required /></label>
}

function FormStatus({ message, success = false }: { message: string | null; success?: boolean }) {
  const status = useRef<HTMLParagraphElement>(null)
  useEffect(() => { if (message && !success) status.current?.focus() }, [message, success])
  return message ? <p ref={status} tabIndex={-1} className={success ? 'form-status success' : 'form-status'} role={success ? 'status' : 'alert'}>{message}</p> : null
}

function SubmitButton({ busy, children }: { busy: boolean; children: ReactNode }) {
  return <button className="primary-action" type="submit" disabled={busy}>{busy ? 'Aguarde…' : children}</button>
}

function readFormString(form: FormData, name: string): string {
  const value = form.get(name)
  return typeof value === 'string' ? value : ''
}

function NotFoundPage() {
  return (
    <main className="standalone-message">
      <span className="brand-mark" aria-hidden="true">⚽</span>
      <h1>Esta tela ainda não existe.</h1>
      <p>Volte para o início da aplicação.</p>
      <Link className="text-link" to="/">Ir para o início</Link>
    </main>
  )
}
