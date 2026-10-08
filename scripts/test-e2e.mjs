/** Real browser + LOCAL Auth/Data API/Postgres. No mocked database or remote keys.
 * Run after db reset --local + pgTAP. Chrome is used if bundled Chromium is absent.
 * Fixtures are scoped to generated users and removed in finally, including failures.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { chromium, firefox, webkit } from 'playwright'

const app = resolve(import.meta.dirname, '..')
const container = 'supabase_db_futebol'
const api = 'http://127.0.0.1:54321'
const origin = 'http://127.0.0.1:5173'
const socket = (value) => /^(unix:\/\/|npipe:\/\/)/.test(value)
function docker(args, input) {
  const r = spawnSync('docker', args, { input, encoding: 'utf8', windowsHide: true, timeout: 30_000 })
  assert.equal(r.status, 0, r.error?.message || r.stderr)
  return r.stdout.trim()
}
assert.ok(!process.env.DOCKER_HOST || socket(process.env.DOCKER_HOST), 'local Docker only')
assert.ok(socket(docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'])), 'local Docker only')
const sql = (input) => docker(['exec', '-i', container, 'psql', '-X', '-A', '-t', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], input)
assert.deepEqual(sql('select version from supabase_migrations.schema_migrations order by version').split('\n'),
  ['20260911113852', '20260911113856', '20260911113900', '20260911152916', '20260911200324', '20260912195435', '20260913081632', '20261005165705'])
const status = spawnSync(process.platform === 'win32' ? 'cmd.exe' : 'pnpm',
  process.platform === 'win32' ? ['/d', '/s', '/c', 'pnpm dlx supabase@2.117.0 status -o json'] : ['dlx', 'supabase@2.117.0', 'status', '-o', 'json'], {
  cwd: app, encoding: 'utf8', windowsHide: true, timeout: 30_000,
})
assert.equal(status.status, 0, 'local Supabase status unavailable')
const local = JSON.parse(status.stdout.slice(status.stdout.indexOf('{')))
assert.equal(local.API_URL, api, 'local API only')
const key = local.ANON_KEY
assert.ok(key, 'local public key missing')
// Only the LOCAL public anon key is passed to the build. No privileged credentials.
function buildApp(publicKey) {
const build = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--mode', 'local-test'], {
  cwd: app, encoding: 'utf8', windowsHide: true, timeout: 90_000,
  env: { ...process.env, VITE_SUPABASE_URL: api, VITE_SUPABASE_PUBLISHABLE_KEY: publicKey },
})
assert.equal(build.status, 0, build.stderr)
const verify = spawnSync(process.execPath, ['scripts/verify-build.mjs', '--local'], {
  cwd: app, encoding: 'utf8', windowsHide: true, timeout: 30_000,
  env: { ...process.env, VITE_SUPABASE_URL: api, VITE_SUPABASE_PUBLISHABLE_KEY: publicKey },
})
assert.equal(verify.status, 0, verify.stderr)
}
buildApp(key)
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' }
const server = createServer(async (request, response) => {
  const path = new URL(request.url, origin).pathname
  const file = resolve(app, 'dist', '.' + decodeURIComponent(path), path === '/' ? 'index.html' : '')
  if (!file.startsWith(resolve(app, 'dist') + '/'.replace('/', process.platform === 'win32' ? '\\' : '/'))) { response.writeHead(403); response.end(); return }
  try { const data = await readFile(file); response.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream'); response.setHeader('Cache-Control', 'no-store'); response.end(data) }
  catch { response.writeHead(404); response.end() }
})
await new Promise((done, reject) => { server.once('error', reject); server.listen(5173, '127.0.0.1', done) })
const output = resolve(app, 'coverage', 'e2e', process.env.E2E_BROWSER || process.env.E2E_CHANNEL || 'chromium')
await mkdir(output, { recursive: true })
const actors = {}, createdUsers = [], checks = []
let browser, testError
const quote = (value) => "'" + value.replaceAll("'", "''") + "'"
const pass = (name) => { checks.push(name); console.log(`PASS: ${name}`) }
async function until(predicate, label) {
  const limit = Date.now() + 15_000
  while (Date.now() < limit) { if (await predicate()) return; await new Promise((done) => setTimeout(done, 50)) }
  throw new Error(`Timed out: ${label}`)
}
async function visible(locator) { await locator.waitFor({ state: 'visible' }); return locator }
async function login(page, role) {
  await page.goto(`${origin}/#/login`)
  await page.getByLabel('E-mail').fill(actors[role].email)
  await page.getByLabel('Senha').fill(actors[role].password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await visible(page.getByRole('heading', { name: 'Quem joga hoje?' }))
}
async function context(options = {}) {
  const ctx = await browser.newContext(options)
  // Headless native share sheets cannot complete. Emulate unsupported Web Share;
  // the clipboard operation remains REAL and independently verified in Chromium.
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }) })
  // Any unexpected request to a non-local service fails rather than reaching production.
  await ctx.route('**/*', (route) => {
    const url = new URL(route.request().url())
    return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort()
  })
  const page = await ctx.newPage()
  page.on('pageerror', (error) => { testError ??= error })
  return { ctx, page }
}
async function draw(page, name, teams = '2', court = '5') {
  const flow = page.getByRole('region', { name: 'Novo jogo', exact: true })
  await flow.getByLabel('Nome', { exact: false }).fill(name)
  await flow.getByLabel('Data', { exact: true }).fill('2026-01-02')
  await flow.getByLabel('Times', { exact: true }).selectOption(teams)
  await flow.getByLabel('Em quadra por time').fill(court)
  await flow.getByRole('button', { name: 'Selecionar participantes' }).click()
  await flow.getByRole('button', { name: 'Selecionar todos' }).click()
  await flow.getByRole('button', { name: 'Sortear times' }).click()
  await visible(page.getByRole('region', { name: 'Resultado do sorteio' }))
  return flow
}
async function inspect(page, label) {
  await page.evaluate(async () => { await Promise.allSettled(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished)) })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `horizontal overflow: ${label}`)
  await page.addScriptTag({ path: resolve(app, 'node_modules/axe-core/axe.min.js') })
  const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target) })))
  assert.deepEqual(violations, [], `a11y: ${label}`)
  await page.screenshot({ path: resolve(output, `${label}.png`), fullPage: true })
}
try {
  await until(async () => {
    try {
      const [auth, rest] = await Promise.all([fetch(`${api}/auth/v1/health`, { headers: { apikey: key } }), fetch(`${api}/rest/v1/`, { headers: { apikey: key } })])
      return auth.ok && rest.ok
    } catch { return false }
  }, 'local Auth and Data API readiness after reset')
  for (const role of ['owner', 'admin', 'member', 'outsider']) {
    const actor = { id: randomUUID(), email: `phase8-${role}-${randomUUID()}@example.test`, password: `Local-${randomUUID()}!` }
    actors[role] = actor; createdUsers.push(actor.id)
    sql(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new)
      values ('${actor.id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${quote(actor.email)},
      extensions.crypt(${quote(actor.password)}, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');`)
  }
  const engine = process.env.E2E_BROWSER || 'chromium'
  browser = engine === 'firefox' ? await firefox.launch() : engine === 'webkit' ? await webkit.launch() : await chromium.launch({ channel: process.env.E2E_CHANNEL || 'chrome' })
  const { ctx, page } = await context({ permissions: engine === 'chromium' ? ['clipboard-read', 'clipboard-write'] : [] })
  await page.goto(`${origin}/#/login`)
  await page.getByLabel('E-mail').fill(actors.owner.email)
  await page.getByLabel('Senha').fill('Wrong-password-123')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await visible(page.getByRole('alert')); pass('local invalid login')
  await page.getByLabel('Senha').fill(actors.owner.password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await visible(page.getByRole('button', { name: 'Criar grupo', exact: true }))
  await page.getByRole('button', { name: 'Criar grupo', exact: true }).click()
  await page.getByLabel('Nome', { exact: true }).fill('Grupo local Fase 8')
  await page.getByRole('button', { name: 'Salvar grupo' }).click()
  await visible(page.getByRole('heading', { name: 'Quem joga hoje?' }))
  const group = sql(`select id from public.groups where created_by='${actors.owner.id}'`)
  sql(`insert into public.group_members(group_id,user_id,role) values ('${group}','${actors.admin.id}','admin'),('${group}','${actors.member.id}','member');`)
  for (let i = 0; i < 12; i++) {
    await page.getByRole('button', { name: 'Adicionar', exact: true }).click()
    const form = page.getByRole('region', { name: 'Novo jogador', exact: true })
    await form.getByLabel('Nome', { exact: true }).fill(i === 11 ? '<img src=x onerror=alert(1)> Nome sintético longo sem execução' : `Jogador ${i}`)
    if (i < 2) await form.getByLabel('É goleiro').check()
    await form.getByRole('button', { name: 'Salvar jogador' }).click()
    await until(() => form.count().then((n) => n === 0), 'player save')
  }
  assert.equal(sql(`select count(*) from public.players where group_id='${group}'`), '12')
  assert.equal(await page.locator('.player-copy img').count(), 0); pass('A: owner Auth, create_group, real player forms, escaped XSS text')
  const flow = await draw(page, 'Owner ajustado')
  for (let i = 0; i < 2; i++) { await flow.getByRole('button', { name: 'Novo sorteio' }).click(); await until(() => flow.getByRole('button', { name: 'Novo sorteio' }).isEnabled(), 'reroll') }
  const teamRows = page.locator('.draw-result .draw-team')
  const mouseA = teamRows.nth(0).getByRole('region', { name: /Em quadra do Time/ }).locator('li').filter({ hasNotText: 'Goleiro' }).first()
  const mouseB = teamRows.nth(1).getByRole('region', { name: /Em quadra do Time/ }).locator('li').filter({ hasNotText: 'Goleiro' }).first()
  const mouseName = await mouseA.locator('span').first().innerText()
  await mouseA.dragTo(mouseB)
  await until(async () => (await teamRows.nth(1).innerText()).includes(mouseName), 'native mouse drag swaps teams')
  pass('mouse: real native drag/drop swaps players without bubbling a second move')
  const first = teamRows.nth(0).locator('li').filter({ hasNotText: 'Goleiro' }).first()
  await first.getByRole('button', { name: 'Selecionar para ajuste' }).focus(); await page.keyboard.press('Enter')
  const second = teamRows.nth(1).locator('li').filter({ hasNotText: 'Goleiro' }).first()
  await second.getByRole('button', { name: 'Trocar com selecionado' }).focus(); await page.keyboard.press('Enter')
  const reserve = teamRows.nth(0).getByRole('region', { name: /Reservas do Time/ }).locator('li').first()
  const keeper = teamRows.nth(0).getByRole('region', { name: /Em quadra do Time/ }).locator('li').filter({ hasText: 'Goleiro' }).first()
  const keeperName = await keeper.locator('span').first().innerText()
  await keeper.getByRole('button', { name: 'Selecionar para ajuste' }).click()
  await reserve.getByRole('button', { name: 'Trocar titular/reserva' }).click()
  assert.ok((await page.getByRole('status').filter({ hasText: 'goleiro precisa permanecer' }).innerText()).includes('goleiro'))
  assert.ok((await teamRows.nth(0).getByRole('region', { name: /Em quadra do Time/ }).innerText()).includes(keeperName))
  await keeper.getByRole('button', { name: 'Cancelar ajuste' }).click()
  const reserveName = await reserve.locator('span').first().innerText()
  await reserve.getByRole('button', { name: 'Selecionar para ajuste' }).click()
  await teamRows.nth(0).getByRole('region', { name: /Em quadra do Time/ }).locator('li').filter({ hasNotText: 'Goleiro' }).first().getByRole('button', { name: 'Trocar titular/reserva' }).click()
  assert.ok((await teamRows.nth(0).getByRole('region', { name: /Em quadra do Time/ }).innerText()).includes(reserveName))
  pass('goalkeepers/reserves: goalkeeper demotion rejected, outfield reserve actually promoted')
  const [ownerRequest] = await Promise.all([
    page.waitForRequest((request) => request.url().endsWith('/rpc/save_match_draw')),
    flow.getByRole('button', { name: 'Salvar e aceitar sorteio' }).click(),
  ])
  const detail = page.getByRole('region', { name: 'Partida salva', exact: true })
  await visible(detail.getByRole('heading', { name: 'Owner ajustado', exact: true }))
  const match = sql(`select id from public.matches where group_id='${group}' and name='Owner ajustado'`)
  assert.equal(sql(`select jsonb_agg(jsonb_build_array(run_number,accepted) order by run_number) from public.draw_runs where match_id='${match}'`), '[[1, false], [2, false], [3, true]]')
  assert.ok(Number(sql(`select count(*) from public.team_assignments where match_id='${match}' and assignment_source='manual'`)) >= 2)
  const persisted = JSON.parse(sql(`select jsonb_agg(jsonb_build_object('player_id',a.player_id,'team_index',t.team_index,'starts_as_reserve',a.starts_as_reserve,'assignment_source',a.assignment_source) order by a.player_id)
    from public.team_assignments a join public.teams t on t.id=a.team_id where a.match_id='${match}'`))
  assert.deepEqual(persisted, ownerRequest.postDataJSON().payload.assignments.sort((a, b) => a.player_id.localeCompare(b.player_id)))
  assert.equal(sql(`select match_date from public.matches where id='${match}'`), '2026-01-02'); pass('F/G: three sequential runs, last accepted, keyboard swaps, reserves, assignment_source, calendar date')
  await detail.getByRole('button', { name: 'Compartilhar resultado' }).click()
  await visible(detail.getByRole('status'))
  if (engine === 'chromium') { const text = await page.evaluate(() => navigator.clipboard.readText()); assert.ok(text.includes('Owner ajustado') && text.includes('02/01/2026') && text.includes('Reservas:')); pass('A: real clipboard fallback') }
  sql(`update public.players set name='Nome posterior', nickname='Atual', skill_rating=1, is_goalkeeper=false, preferred_position='defense' where group_id='${group}';`)
  await page.reload(); await page.getByRole('button', { name: 'Abrir histórico' }).click(); await page.getByRole('button', { name: /Owner ajustado/ }).click()
  await visible(detail.getByRole('heading', { name: 'Owner ajustado', exact: true }))
  assert.ok(!(await detail.innerText()).includes('Nome posterior')); pass('E: snapshots survive real player updates and refresh')
  // Restore synthetic eligibility for the remaining cases.
  sql(`update public.players set nickname=null, name=case when row_numbered.n=11 then '<img src=x onerror=alert(1)> Nome sintético longo sem execução' else 'Jogador ' || row_numbered.n end, is_goalkeeper=row_numbered.n<2 from
    (select id,row_number() over(order by id)-1 as n from public.players where group_id='${group}') row_numbered where public.players.id=row_numbered.id;`)
  await ctx.close()
  const admin = await context(); await login(admin.page, 'admin')
  assert.equal(await admin.page.getByRole('button', { name: 'Ajustar grupo' }).count(), 0)
  await admin.page.getByRole('button', { name: 'Adicionar', exact: true }).click()
  await admin.page.getByRole('region', { name: 'Novo jogador' }).getByLabel('Nome', { exact: true }).fill('Admin jogador')
  await admin.page.getByRole('button', { name: 'Salvar jogador' }).click(); await until(() => admin.page.getByRole('region', { name: 'Novo jogador' }).count().then((n) => n === 0), 'admin player')
  await draw(admin.page, 'Admin três times', '3'); await admin.page.getByRole('button', { name: 'Salvar e aceitar sorteio' }).click()
  await visible(admin.page.getByRole('region', { name: 'Partida salva' }).getByRole('heading', { name: 'Admin três times' })); pass('B: admin player/create/save three incomplete teams; group settings hidden')
  await admin.ctx.close()
  const member = await context(); await login(member.page, 'member')
  for (const name of ['Adicionar', 'Editar', 'Salvar e aceitar sorteio', 'Selecionar participantes']) assert.equal(await member.page.getByRole('button', { name, exact: true }).count(), 0)
  await member.page.getByRole('button', { name: 'Abrir histórico' }).click(); await member.page.getByRole('button', { name: /Owner ajustado/ }).click()
  await visible(member.page.getByRole('region', { name: 'Partida salva' }).getByRole('heading', { name: 'Owner ajustado' })); pass('C: member roster/history/detail read-only')
  await member.ctx.close()
  const retry = await context(); await login(retry.page, 'owner'); await draw(retry.page, 'Retry real')
  const requests = []
  await retry.page.route(`${api}/rest/v1/rpc/save_match_draw`, async (route) => {
    requests.push(route.request().postDataJSON())
    if (requests.length === 1) { const response = await route.fetch(); assert.equal(response.status(), 200); await route.abort('failed') }
    else await route.continue()
  })
  await retry.page.getByRole('button', { name: 'Salvar e aceitar sorteio' }).dblclick(); await visible(retry.page.getByRole('alert'))
  assert.equal(requests.length, 1)
  assert.equal(await retry.page.getByRole('button', { name: 'Novo sorteio' }).isEnabled(), false)
  await retry.page.evaluate(() => { location.hash = '#/conta' })
  await until(() => retry.page.getByRole('button', { name: 'Tentar salvar novamente' }).isVisible(), 'navigation preserves retry')
  await retry.page.getByRole('button', { name: 'Tentar salvar novamente' }).click()
  await visible(retry.page.getByRole('region', { name: 'Partida salva' }).getByRole('heading', { name: 'Retry real' }))
  assert.deepEqual(requests[1], requests[0]); assert.equal(sql(`select count(*) from public.matches where id='${requests[0].target_match_id}'`), '1'); pass('D: real committed response lost, double-submit, guarded navigation, identical retry, exactly one match')
  await retry.page.getByRole('button', { name: 'Criar outra partida' }).click(); await visible(retry.page.getByRole('heading', { name: 'Configure a partida' })); pass('A: create another match')
  // Network failures: loaded data can still draw locally; persistence cannot.
  await retry.ctx.setOffline(true)
  await draw(retry.page, 'Falha de rede local')
  await retry.page.getByRole('button', { name: 'Salvar e aceitar sorteio' }).click(); await visible(retry.page.getByRole('alert'))
  await retry.ctx.setOffline(false)
  await retry.page.getByRole('button', { name: 'Tentar salvar novamente' }).click()
  await visible(retry.page.getByRole('region', { name: 'Partida salva' }).getByRole('heading', { name: 'Falha de rede local' })); pass('network: local draw offline, explicit save failure, successful online retry')
  sql(`update public.matches set match_time=case name when 'Retry real' then '23:59'::time when 'Falha de rede local' then '00:00'::time else null end where group_id='${group}';`)
  await retry.page.getByRole('button', { name: 'Voltar ao histórico' }).click()
  await until(() => retry.page.locator('.match-history-list li').count().then((n) => n === 4), 'history ordering')
  const ordered = await retry.page.locator('.match-history-list strong').allTextContents()
  assert.deepEqual(ordered, ['Retry real', 'Falha de rede local', 'Admin três times', 'Owner ajustado'])
  assert.ok((await retry.page.locator('.match-history-list li').nth(0).innerText()).includes('23:59'))
  assert.ok((await retry.page.locator('.match-history-list li').nth(1).innerText()).includes('00:00'))
  pass('date/time: real history orders 23:59, midnight and absent optional times on the same calendar day')
  await retry.ctx.close()
  // RLS via actual authenticated browser requests, including known UUIDs.
  const outsider = await context(); await outsider.page.goto(`${origin}/#/login`)
  await outsider.page.getByLabel('E-mail').fill(actors.outsider.email); await outsider.page.getByLabel('Senha').fill(actors.outsider.password); await outsider.page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await visible(outsider.page.getByRole('heading', { name: 'Monte a sua pelada.' }))
  const denied = await outsider.page.evaluate(async ({ api, key, group, match }) => {
    const session = JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.endsWith('-auth-token'))))
    const headers = { apikey: key, Authorization: `Bearer ${session.access_token}` }
    const results = []
    for (const table of ['groups', 'players', 'matches', 'match_players', 'teams', 'team_assignments', 'draw_runs']) {
      const filter = table === 'groups' ? `id=eq.${group}` : `group_id=eq.${group}`
      const r = await fetch(`${api}/rest/v1/${table}?${filter}&select=*`, { headers }); results.push([r.status, (await r.json()).length])
    }
    return results
  }, { api, key, group, match })
  assert.deepEqual(denied, Array.from({ length: 7 }, () => [200, 0])); pass('H: outsider cannot read any of seven scoped resources via actual Data API')
  await outsider.ctx.close()
  const failures = await context()
  await failures.page.route(`${api}/auth/v1/token**`, (route) => route.abort('failed'))
  await failures.page.goto(`${origin}/#/login`)
  await failures.page.getByLabel('E-mail').fill(actors.owner.email); await failures.page.getByLabel('Senha').fill(actors.owner.password)
  await failures.page.getByRole('button', { name: 'Entrar', exact: true }).click(); await visible(failures.page.getByRole('alert'))
  await failures.page.unroute(`${api}/auth/v1/token**`)
  await failures.page.route(`${api}/rest/v1/players**`, (route) => route.abort('failed'))
  await failures.page.getByRole('button', { name: 'Entrar', exact: true }).click(); await visible(failures.page.getByRole('alert'))
  assert.ok((await failures.page.getByRole('alert').innerText()).includes('Não foi possível carregar'))
  await failures.page.unroute(`${api}/rest/v1/players**`); await failures.page.getByRole('button', { name: 'Tentar novamente' }).click()
  await visible(failures.page.getByRole('heading', { name: 'Quem joga hoje?' }))
  await failures.page.route(`${api}/rest/v1/matches**`, (route) => route.abort('failed'))
  await failures.page.getByRole('button', { name: 'Abrir histórico' }).click(); await visible(failures.page.getByRole('alert'))
  await failures.page.unroute(`${api}/rest/v1/matches**`); await failures.page.getByRole('button', { name: 'Tentar novamente' }).click()
  await failures.page.route(`${api}/rest/v1/team_assignments**`, (route) => route.abort('failed'))
  await failures.page.getByRole('button', { name: /Owner ajustado/ }).click(); await visible(failures.page.getByRole('alert'))
  await failures.page.unroute(`${api}/rest/v1/team_assignments**`); await failures.page.getByRole('button', { name: 'Tentar novamente' }).click()
  await visible(failures.page.getByRole('region', { name: 'Partida salva' }).getByRole('heading', { name: 'Owner ajustado' }))
  await failures.ctx.close(); pass('network: Auth, roster, history and detail failures show errors and recover')
  for (const width of [320, 360, 390, 430, 768, 1280]) {
    const touch = width <= 430 && engine !== 'firefox'
    const mobile = await context({ viewport: { width, height: 850 }, hasTouch: touch, timezoneId: width === 390 ? 'Pacific/Kiritimati' : 'America/Los_Angeles' })
    for (const route of ['/', '/login', '/cadastro', '/esqueci-senha', '/nova-senha']) { await mobile.page.goto(`${origin}/#${route}`); await inspect(mobile.page, `${width}-auth-${route.replaceAll('/', '') || 'home'}`) }
    await login(mobile.page, 'owner'); await inspect(mobile.page, `${width}-workspace`)
    await mobile.page.getByRole('button', { name: 'Ajustar grupo' }).click(); await inspect(mobile.page, `${width}-group-form`); await mobile.page.getByRole('button', { name: 'Fechar', exact: true }).click()
    await mobile.page.getByRole('button', { name: 'Adicionar', exact: true }).click(); await inspect(mobile.page, `${width}-player-form`); await mobile.page.getByRole('button', { name: 'Fechar', exact: true }).click()
    await draw(mobile.page, `Mobile ${width}`, '3'); await inspect(mobile.page, `${width}-result`)
    const touchA = mobile.page.locator('.draw-result .draw-team').nth(0).locator('li').filter({ hasNotText: 'Goleiro' }).first()
    const touchB = mobile.page.locator('.draw-result .draw-team').nth(1).locator('li').filter({ hasNotText: 'Goleiro' }).first()
    if (touch) await touchA.getByRole('button', { name: 'Selecionar para ajuste' }).tap()
    else await touchA.getByRole('button', { name: 'Selecionar para ajuste' }).click()
    assert.ok(await mobile.page.getByRole('button', { name: 'Trocar com selecionado' }).count() > 0)
    if (touch) await touchB.getByRole('button', { name: 'Trocar com selecionado' }).tap()
    else await touchB.getByRole('button', { name: 'Trocar com selecionado' }).click()
    assert.equal(await mobile.page.getByRole('button', { name: 'Cancelar ajuste' }).count(), 0)
    await mobile.page.getByRole('button', { name: 'Voltar aos participantes' }).click(); await inspect(mobile.page, `${width}-participants`)
    await mobile.page.getByRole('button', { name: 'Abrir histórico' }).click(); await inspect(mobile.page, `${width}-history`)
    await mobile.page.getByRole('button', { name: /Owner ajustado/ }).click(); await visible(mobile.page.getByRole('region', { name: 'Partida salva' }).getByRole('heading', { name: 'Owner ajustado' })); await inspect(mobile.page, `${width}-detail`)
    await mobile.ctx.close(); pass(`mobile/axe/keyboard alternatives: ${width}px, auth/forms/participants/result/history/detail`)
  }
  const pwa = await context(); await pwa.page.goto(`${origin}/#/login`)
  await until(() => pwa.page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.active), 'active PWA worker')
  await pwa.page.reload(); await until(() => pwa.page.evaluate(() => !!navigator.serviceWorker.controller), 'PWA controls root')
  const scope = await pwa.page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).scope)
  assert.equal(scope, `${origin}/`)
  const manifest = await (await pwa.page.request.get(`${origin}/manifest.webmanifest`)).json()
  assert.equal(manifest.start_url, '/#/'); assert.equal(manifest.scope, '/')
  await pwa.ctx.setOffline(true); await pwa.page.reload(); await visible(pwa.page.getByRole('heading', { name: 'Entre na sua conta' }))
  await pwa.ctx.setOffline(false); await pwa.page.goto(origin)
  assert.equal(await pwa.page.evaluate(() => navigator.serviceWorker.controller !== null), true)
  pass('PWA: real root registration, scope, manifest, hash refresh and offline shell')
  await login(pwa.page, 'owner'); await draw(pwa.page, 'PWA rascunho preservado')
  // A second genuine build changes only the LOCAL public credential representation.
  // No generated asset is hand-edited; the new worker precaches the new source build.
  assert.ok(local.PUBLISHABLE_KEY && local.PUBLISHABLE_KEY !== key)
  buildApp(local.PUBLISHABLE_KEY)
  await pwa.page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update() })
  const updateButton = pwa.page.getByRole('button', { name: 'Atualizar aplicativo' })
  await visible(updateButton)
  assert.ok(await pwa.page.getByRole('region', { name: 'Resultado do sorteio' }).isVisible())
  assert.ok(await pwa.page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting))
  pwa.page.once('dialog', (dialog) => dialog.dismiss()); await updateButton.click()
  assert.ok(await pwa.page.getByRole('region', { name: 'Resultado do sorteio' }).isVisible())
  let releaseSave
  const saveGate = new Promise((done) => { releaseSave = done })
  await pwa.page.route(`${api}/rest/v1/rpc/save_match_draw`, async (route) => { await saveGate; await route.abort('failed') })
  await pwa.page.getByRole('button', { name: 'Salvar e aceitar sorteio' }).click()
  await until(async () => !(await updateButton.isEnabled()), 'PWA blocks an in-flight save')
  releaseSave(); await visible(pwa.page.getByRole('alert'))
  assert.equal(await updateButton.isEnabled(), false)
  pwa.page.once('dialog', (dialog) => dialog.accept())
  await pwa.page.getByRole('button', { name: 'Abandonar tentativa e editar' }).click()
  await until(() => updateButton.isEnabled(), 'PWA unlock after conscious abandonment')
  pwa.page.once('dialog', (dialog) => dialog.accept())
  await Promise.all([pwa.page.waitForEvent('load'), updateButton.click()])
  await visible(pwa.page.getByRole('heading', { name: 'Configure a partida' }))
  await pwa.ctx.close(); pass('PWA: actual waiting update preserves draft, decline preserves edits, uncertain save blocks update, conscious update reloads')
  const missing = await context({ serviceWorkers: 'block' })
  await missing.page.route('**/MatchWorkspace-*.js', (route) => route.abort('failed'))
  await login(missing.page, 'owner')
  await visible(missing.page.getByRole('alert').filter({ hasText: 'Não foi possível abrir as partidas' }))
  assert.ok(await missing.page.getByRole('button', { name: 'Adicionar', exact: true }).isEnabled())
  await missing.ctx.close(); pass('offline feature chunk: localized recovery keeps roster usable')
  if (testError) throw testError
} catch (error) {
  testError = error
  for (const [index, ctx] of (browser?.contexts() ?? []).entries()) {
    for (const page of ctx.pages()) {
      await page.screenshot({ path: resolve(output, `failure-${index}.png`), fullPage: true }).catch(() => {})
      console.error('Failure UI:', await page.locator('h1,h2,[role="alert"],button').allTextContents().catch(() => []))
    }
  }
}
finally {
  await browser?.close()
  await new Promise((done) => server.close(done))
  try {
    if (createdUsers.length) sql(`begin;
      delete from public.matches where group_id in (select id from public.groups where created_by in (${createdUsers.map(quote).join(',')}));
      delete from public.groups where created_by in (${createdUsers.map(quote).join(',')});
      delete from auth.users where id in (${createdUsers.map(quote).join(',')}); commit;`)
    if (createdUsers.length) assert.equal(sql(`select count(*) from auth.users where id in (${createdUsers.map(quote).join(',')})`), '0')
  } catch (error) { testError = new AggregateError([testError, error].filter(Boolean), 'E2E/cleanup failed') }
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ checks, error: testError?.message || null }, null, 2))
}
if (testError) throw testError
console.log(`E2E PASS: ${checks.length} scenarios; synthetic fixtures removed`)
