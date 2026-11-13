import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const real = process.argv.includes('--real')
const write = process.argv.includes('--write-fixture')
assert.ok(!write || real)
const testGroup = 'FASE5A Mobile UX 2026-11-08'
const fixtureName = 'FASE7C DEV ' + new Date().toISOString().replace(/[:.]/g, '-')
const config = JSON.parse(await readFile('deployment/frontend-dev.json', 'utf8'))
const api = new URL(config.apiBaseUrl).origin
assert.equal(config.environment, 'dev')
assert.equal(config.appOrigin, 'http://localhost:5173')
assert.equal(config.identity.domain, 'https://sabara-test.eu.kinde.com')
const accounts = real ? [...(await readFile('deployment/OPERATIONS.md', 'utf8')).matchAll(/^\| Teste \d+ \| `([^`]+)`/gm)].map(match => match[1]) : []
const profile = 'd0000000-0000-0000-0000-000000000001'
const other = 'd0000000-0000-0000-0000-000000000002'
const group = 'a0000000-0000-0000-0000-000000000001'
const fixturePlayers = Array.from({ length: 4 }, (_, index) => ({
  id: `b0000000-0000-0000-0000-00000000000${index + 1}`, group_id: group, name: `Jogador ${index + 1}`,
  nickname: null, skill_rating: 3, preferred_position: null, is_goalkeeper: false, active: true,
}))
const contentTypes = { html: 'text/html', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', webmanifest: 'application/manifest+json' }
const server = createServer(async (req, res) => {
  const path = new URL(req.url, config.appOrigin).pathname.replace(/^\/$/, '/index.html')
  if (!/^\/(?:index\.html|sw\.js|workbox-[\w-]+\.js|(?:assets|icons)\/[\w.-]+|favicon\.ico|manifest\.webmanifest)$/.test(path)) return res.writeHead(404).end()
  try { res.writeHead(200, { 'Content-Type': contentTypes[path.split('.').at(-1)] ?? 'application/octet-stream' }).end(await readFile('dist-dev' + path)) }
  catch { if (!res.headersSent) res.writeHead(404); res.end() }
})
// The DEV OAuth callback requires localhost:5173 in both cases.
const localOrigin = config.appOrigin
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(5173, resolve) })
let browser
let step = 'Chrome'
const evidence = []
try {
  browser = await chromium.launch({ channel: 'chrome' })
  const context = await browser.newContext({ serviceWorkers: 'block' })
  let userId = profile
  let role = 'owner'
  let mutations = 0
  let creations = 0
  let reads = 0
  let graph
  let sent
  let loseResponse = true
  let exposeGraph = true
  let realGroupId
  let realCommit
  const jwt = () => {
    const now = Math.floor(Date.now() / 1000)
    return [{ alg: 'RS256', kid: 'fixture' }, { sub: userId, given_name: 'Fixture', iss: config.identity.domain, exp: now + 600, iat: now }, 'fixture']
      .map(part => Buffer.from(JSON.stringify(part)).toString('base64url')).join('.')
  }
  const cors = { 'Access-Control-Allow-Origin': localOrigin, 'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS', 'Access-Control-Allow-Headers': 'authorization,content-type' }
  await context.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin === localOrigin) return route.continue()
    if (url.origin === api) {
      if (real) {
        if (request.method() === 'GET' && url.pathname === '/workspace') {
          const response = await route.fetch()
          if (response.ok()) {
            const workspace = await response.json()
            const candidates = workspace.groups.filter(entry => entry.name === testGroup && entry.role === 'owner')
            realGroupId = candidates.length === 1 ? candidates[0].id : undefined
          }
          return route.fulfill({ response })
        }
        if (!['GET', 'OPTIONS'].includes(request.method())) {
          mutations++
          const payload = request.postDataJSON()
          if (!write || request.method() !== 'PUT' || mutations !== 1 || !realGroupId
            || payload?.group_id !== realGroupId || payload.name !== fixtureName
            || !/^\/matches\/[0-9a-f-]{36}\/draw$/.test(url.pathname)) return route.abort()
          const response = await route.fetch({ maxRetries: 0 })
          realCommit = response.status()
          return route.abort('failed')
        }
        return route.continue()
      }
      const reply = (json, status = 200) => route.fulfill({ json, status, headers: cors })
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      if (url.pathname === '/me') return reply({ id: userId })
      if (url.pathname === '/workspace') return reply({
        groups: [{ id: group, name: 'Grupo sintético 7C', role, sport: 'futsal', default_players_on_court: 1 }],
        players: fixturePlayers,
      })
      if (request.method() === 'PUT') {
        mutations++
        const id = url.pathname.split('/')[2]
        const payload = request.postDataJSON()
        if (sent) assert.deepEqual({ id, payload }, sent)
        else {
          sent = { id, payload }
          const teams = payload.teams.map(team => ({ ...team, id: String(team.team_index) }))
          graph = {
            match: { ...payload, id, created_by: userId, status: 'drawn', match_time: payload.match_time && payload.match_time + ':00' },
            participants: payload.participants.map(p => ({ ...p, attendance_status: 'present' })), teams,
            assignments: payload.assignments.map(a => ({ ...a, team_id: String(a.team_index) })),
            runs: payload.draw_runs.map(run => ({ ...run, balance_score: Math.round(run.balance_score * 1000) / 1000 })),
          }
        }
        if (loseResponse) { loseResponse = false; return route.abort('failed') }
        return reply({ id })
      }
      if (request.method() === 'POST') { creations++; return reply({}) }
      if (url.pathname.endsWith('/matches')) return reply([])
      reads++
      return graph && exposeGraph && url.pathname.endsWith('/' + graph.match.id) ? reply(graph) : reply({}, 404)
    }
    if (url.origin !== config.identity.domain) return route.abort()
    if (real) return route.continue()
    if (url.pathname === '/oauth2/token') return route.fulfill({ json: { access_token: jwt(), id_token: jwt(), refresh_token: 'fixture', expires_in: 600 } })
    if (url.pathname === '/oauth2/auth') {
      const callback = new URL(localOrigin)
      callback.searchParams.set('code', 'fixture')
      callback.searchParams.set('state', url.searchParams.get('state'))
      return route.fulfill({ status: 302, headers: { location: callback.href } })
    }
    if (url.pathname.includes('logout')) return route.fulfill({ status: 302, headers: { location: localOrigin } })
    return route.abort()
  })

  const events = []
  context.on('response', response => {
    const url = new URL(response.url())
    if ((url.origin === api && ['/me', '/workspace'].includes(url.pathname)) ||
      (url.origin === config.identity.domain && url.pathname === '/oauth2/token')) events.push([url.pathname, response.status()])
  })
  let page = await context.newPage()
  const button = (name, p = page) => p.getByRole('button', { name, exact: true })
  const name = (p = page) => p.getByRole('textbox', { name: /^Nome.*opcional/ })
  const draftSaved = (p = page) => p.getByText('Rascunho guardado neste dispositivo.', { exact: true })
  const inputValue = async (locator, value) => assert.equal(await locator.inputValue({ timeout: 15_000 }), value)
  async function login(p = page, account = accounts[0]) {
    const entry = button('Entrar com Sabará ID', p)
    const workspace = p.getByRole('heading', { name: 'Quem joga hoje?' })
    await entry.or(workspace).first().waitFor({ timeout: 20_000 })
    if (await entry.isVisible()) {
      await entry.click({ timeout: 15_000 })
      if (real) {
        assert.ok(account)
        const email = p.locator('input[type=email],input[autocomplete=username]').filter({ visible: true }).first()
        const password = p.locator('input[type=password]').filter({ visible: true }).first()
        const first = await Promise.race([
          email.waitFor({ state: 'visible', timeout: 12_000 }).then(() => 'form'),
          p.waitForURL(url => url.origin === localOrigin && url.searchParams.has('code'), { timeout: 12_000 }).then(() => 'callback'),
        ]).catch(() => 'maybe-ready')
        if (first === 'form') {
          await email.fill(account, { timeout: 10_000 })
          if (!await password.isVisible()) await email.press('Enter')
          await password.fill(account, { timeout: 10_000 })
          await password.press('Enter')
        }
      }
    }
    await workspace.waitFor({ timeout: 20_000 })
  }
  async function reload(p = page) { await p.reload(); await login(p) }
  async function persist(p = page) { await draftSaved(p).first().waitFor({ timeout: 10_000 }) }
  async function hide(p = page) {
    await p.evaluate(() => {
      const old = Object.getOwnPropertyDescriptor(document, 'visibilityState')
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
      if (old) Object.defineProperty(document, 'visibilityState', old)
      else delete document.visibilityState
    })
  }
  async function draw(withRule = false) {
    await button('Selecionar participantes').click()
    await button('Selecionar todos').click()
    if (withRule) {
      await button('Adicionar regra').click()
      await page.getByLabel('Tipo de regra').selectOption('fixed')
      await page.getByLabel('Primeiro jogador').selectOption({ label: 'Jogador 1' })
      await page.getByLabel('Time fixo').selectOption({ label: 'Time Azul' })
      await button('Ativar regra').click()
    }
    await button('Sortear times').click()
    await page.getByRole('heading', { name: 'Times sorteados' }).waitFor()
  }
  async function discard() {
    await button('Descartar rascunho').click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Descartar rascunho' }).click()
    await page.waitForFunction(() => document.querySelector('.draw-panel input[name=name]')?.value === '')
  }

  step = 'login e armazenamento'
  await page.goto(localOrigin)
  await login()
  if (write) {
    step = 'selecionar o grupo DEV de homologação documentado'
    assert.ok(realGroupId)
    await button(testGroup).click()
    await page.locator('.group-chip[aria-pressed=true]').filter({ hasText: testGroup }).waitFor()
  }
  await name().fill('Partida sintética 7C')
  await page.locator('[name=matchDate]').fill('2026-11-20')
  await page.locator('[name=matchTime]').fill('19:45')
  await page.getByLabel('Modo de sorteio').selectOption('balanced')
  await page.getByLabel('Evitar repetições recentes').check()
  await hide()
  await persist()
  await reload()
  await inputValue(name(), 'Partida sintética 7C')
  await inputValue(page.locator('[name=matchDate]'), '2026-11-20')
  await inputValue(page.locator('[name=matchTime]'), '19:45')
  assert.equal(await page.getByLabel('Evitar repetições recentes').isChecked(), true)
  evidence.push('Digitação, ocultação e recarga: configuração restaurada após nova verificação.')
  step = 'reinício e cadastro parcial'
  await button('Selecionar participantes').click()
  const selectAll = button('Selecionar todos')
  if (await selectAll.count()) await selectAll.click()
  const selection = page.locator('.selection-count')
  const count = await selection.count() ? await selection.textContent() : null
  await button('Adicionar').click()
  const playerForm = () => page.getByRole('region', { name: 'Novo jogador' })
  await playerForm().getByRole('textbox', { name: 'Nome', exact: true }).fill('Cadastro parcial 7C')
  await playerForm().getByRole('textbox', { name: /Apelido/ }).fill('Parcial')
  await playerForm().getByLabel('É goleiro').check()
  await playerForm().getByText('Rascunho guardado neste dispositivo.').waitFor()
  await page.close()
  page = await context.newPage()
  await page.goto(localOrigin)
  await login()
  if (write) await button(testGroup).click()
  await inputValue(playerForm().getByRole('textbox', { name: 'Nome', exact: true }), 'Cadastro parcial 7C')
  await inputValue(playerForm().getByRole('textbox', { name: /Apelido/ }), 'Parcial')
  assert.equal(await playerForm().getByLabel('É goleiro').isChecked(), true)
  if (count) assert.equal(await page.locator('.selection-count').textContent(), count)
  assert.equal(creations + mutations, 0)
  evidence.push('Fechamento e novo documento: participantes e cadastro parcial recuperados, zero criação implícita.')

  if (real) {
    step = 'DEV histórico autorizado e confirmação'
    await button('Abrir histórico').click()
    await page.getByRole('region', { name: 'Histórico de partidas' }).getByRole('heading', { name: 'Histórico de partidas' }).waitFor()
    assert.ok(events.some(([path, status]) => path === '/oauth2/token' && status === 200))
    assert.ok(events.some(([path, status]) => path === '/me' && status === 200))
    assert.ok(events.some(([path, status]) => path === '/workspace' && status === 200))
    assert.equal(mutations, 0)
    evidence.push('Kinde Test e Neon DEV responderam 200 para autenticação e workspace.')
    if (write) {
      step = 'PUT de fixture no Neon DEV e perda da resposta'
      await button(testGroup).click()
      const returnToDetails = page.getByRole('button', { name: /^(Voltar|Voltar à configuração)$/ })
      if (await returnToDetails.isVisible()) await returnToDetails.click()
      await name().fill(fixtureName)
      await page.getByLabel('Modo de sorteio').selectOption('classic')
      await draw()
      await button('Salvar e aceitar sorteio').click()
      await page.getByText('Partida salva e sorteio aceito.', { exact: false }).waitFor()
      await page.getByRole('region', { name: 'Partida salva' }).getByRole('heading', { name: fixtureName }).waitFor()
      assert.equal(realCommit, 200)
      assert.equal(mutations, 1)
      await reload()
      await inputValue(name(), '')
      evidence.push('Neon DEV: um PUT retornou 200. O navegador perdeu a resposta e confirmou a partida pelo histórico autorizado, sem segundo PUT.')
    } else {
      evidence.push('Todas as mutações foram bloqueadas no navegador.')
    }
  } else {
    step = 'concorrência'
    await playerForm().getByRole('button', { name: 'Fechar' }).click()
    await button('Voltar').click()
    await persist()
    const tab = await context.newPage()
    await tab.goto(localOrigin)
    await login(tab)
    await inputValue(name(tab), 'Partida sintética 7C')
    await name().fill('Revisão da primeira aba')
    await persist()
    await name(tab).fill('Escrita antiga')
    await tab.getByRole('alert').filter({ hasText: 'Outra aba alterou' }).waitFor()
    await button('Abrir revisão mais recente', tab).click()
    await inputValue(name(tab), 'Revisão da primeira aba')
    await tab.close()
    evidence.push('Duas abas: CAS recusou revisão antiga e reabriu a mais recente.')
    step = 'sorteio e ajustes'
    await page.getByLabel('Modo de sorteio').selectOption('classic')
    await draw(true)
    await button('Novo sorteio').click()
    await page.getByText('2 sorteio(s) nesta partida.', { exact: false }).waitFor()
    await page.getByRole('button', { name: /Selecionar para ajuste/ }).first().click()
    await button('Trocar titular/reserva').first().click()
    await page.getByText('Ajustado manualmente', { exact: false }).waitFor()
    const lineup = await page.locator('.draw-teams').innerText()
    await persist()
    await reload()
    await page.getByRole('heading', { name: 'Times sorteados' }).waitFor()
    assert.equal(await page.locator('.draw-teams').innerText(), lineup)
    assert.equal(await page.getByText('2 sorteio(s) nesta partida.', { exact: false }).count(), 1)
    assert.equal(await page.getByText('1 regra(s) ativa(s).', { exact: false }).count(), 1)
    evidence.push('Rodadas e ajuste manual voltaram com a mesma escalação.')
    step = 'resposta perdida'
    exposeGraph = false
    await button('Salvar e aceitar sorteio').click()
    await page.getByText('A partida ainda não apareceu no histórico.', { exact: false }).waitFor()
    assert.equal(mutations, 1)
    await reload()
    await page.getByText('A partida ainda não apareceu no histórico.', { exact: false }).waitFor()
    assert.equal(mutations, 1)
    // The fixture committed before losing the response. An explicit retry must be identical.
    exposeGraph = true
    await button('Tentar salvar novamente').click()
    await page.getByText('Partida salva e sorteio aceito.', { exact: false }).waitFor()
    assert.equal(mutations, 2)
    assert.ok(reads >= 2)
    await button('Criar outra partida').click()
    await name().fill('Reconciliação automática de leitura')
    await draw()
    sent = undefined
    loseResponse = true
    await button('Salvar e aceitar sorteio').click()
    await page.getByText('Partida salva e sorteio aceito.', { exact: false }).waitFor()
    assert.equal(mutations, 3)
    evidence.push('Resposta perdida: leitura por UUID confirmou o grafo. Retry explícito repetiu UUID e payload, sem segundo grafo.')
    step = 'revogação e descarte'
    await button('Criar outra partida').click()
    await name().fill('Acesso removido')
    await persist()
    role = 'member'
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await page.getByText('Membro', { exact: true }).waitFor()
    await name().waitFor({ state: 'detached' })
    role = 'owner'
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await inputValue(name(), '')
    await name().fill('Descartar explicitamente')
    await persist()
    await discard()
    await reload()
    await inputValue(name(), '')
    evidence.push('Revogação removeu o rascunho. Nova permissão e descarte explícito abriram edição vazia.')
    step = 'logout e conta'
    await name().fill('Privado da primeira conta')
    await persist()
    userId = other
    const otherTab = await context.newPage()
    await otherTab.goto(localOrigin)
    await login(otherTab)
    await inputValue(name(otherTab), '')
    await name(otherTab).fill('Privado da segunda conta')
    await persist(otherTab)
    await button('Sair', otherTab).click()
    await otherTab.getByRole('alertdialog').getByRole('button', { name: 'Descartar e sair' }).click()
    await button('Entrar com Sabará ID', otherTab).waitFor()
    await login(otherTab)
    await inputValue(name(otherTab), '')
    await button('Entrar com Sabará ID').waitFor()
    await otherTab.close()
    evidence.push('Troca de conta e logout: conteúdo anterior indisponível.')
    step = 'IndexedDB indisponível'
    await context.addInitScript(() => Object.defineProperty(window, 'indexedDB', { get: () => undefined }))
    await reload()
    await page.getByRole('alert').filter({ hasText: 'armazenamento local está indisponível' }).waitFor()
    await name().fill('Somente em memória')
    await draw()
    assert.equal(await button('Salvar e aceitar sorteio').isDisabled(), true)
    assert.equal(mutations, 3)
    evidence.push('IndexedDB indisponível: alerta visível e envio da partida bloqueado.')
  }
  console.log(JSON.stringify({ mode: real ? 'DEV real' : 'Chrome controlado', evidence, ...(real && { events }), ...(write && { fixtureName, writes: mutations, upstreamStatus: realCommit }) }, null, 2))
} catch (error) {
  // Do not print URLs, selectors that include data, login fields or browser dumps.
  console.error(`FALHOU em ${step} (${error.name}). Cenários aprovados: ${evidence.join(' ')}`)
  if (!real) console.error(error)
  process.exitCode = 1
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
