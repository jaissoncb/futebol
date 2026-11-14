import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { chromium } from 'playwright'

const config = JSON.parse(await readFile('deployment/frontend-dev.json', 'utf8'))
const origin = config.appOrigin
const group = 'a0000000-0000-0000-0000-000000000001'
const profile = 'd0000000-0000-0000-0000-000000000001'
const players = Array.from({ length: 120 }, (_, index) => ({
  id: 'b0000000-0000-0000-0000-' + String(index + 1).padStart(12, '0'),
  group_id: group, name: 'Jogador ' + (index + 1), skill_rating: 3, active: true,
  nickname: null, preferred_position: null, is_goalkeeper: false,
}))
const types = { html: 'text/html', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', webmanifest: 'application/manifest+json' }
const server = createServer(async (request, response) => {
  const path = new URL(request.url, origin).pathname.replace(/^\/$/, '/index.html')
  if (!/^\/(index\.html|sw\.js|workbox-[\w-]+\.js|(?:assets|icons)\/[\w.-]+|favicon\.ico|manifest\.webmanifest)$/.test(path)) return response.writeHead(404).end()
  try {
    const asset = await readFile('dist-dev' + path)
    response.writeHead(200, { 'Content-Type': types[path.split('.').at(-1)] ?? 'application/octet-stream' }).end(asset)
  } catch { response.writeHead(404).end() }
})
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(5173, resolve) })
let browser
try {
  browser = await chromium.launch({ channel: 'chrome', headless: !process.argv.includes('--headed'),
    ignoreDefaultArgs: ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'] })
  const viewport = process.argv.includes('--mobile') ? { width: 390, height: 844 } : { width: 1360, height: 900 }
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' })
  const calls = []
  let workspaceStatus = 200
  let returnedProfile = profile
  let role = 'owner'
  const jwt = () => {
    const now = Math.floor(Date.now() / 1000)
    return [{ alg: 'RS256', kid: 'fixture' }, { sub: profile, given_name: 'Fixture', iss: config.identity.domain, exp: now + 600, iat: now }, 'fixture']
      .map(part => Buffer.from(JSON.stringify(part)).toString('base64url')).join('.')
  }
  await context.route('**/*', route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin === origin) return route.continue()
    if (url.origin === config.identity.domain && url.pathname === '/oauth2/auth') {
      const callback = new URL(origin)
      callback.searchParams.set('code', 'fixture')
      callback.searchParams.set('state', url.searchParams.get('state'))
      return route.fulfill({ status: 302, headers: { location: callback.href } })
    }
    if (url.origin === config.identity.domain && url.pathname === '/oauth2/token') {
      calls.push([url.pathname, 200])
      return route.fulfill({ json: { access_token: jwt(), id_token: jwt(), refresh_token: 'fixture', expires_in: 600 } })
    }
    if (url.origin !== config.apiBaseUrl) return route.abort()
    const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization,content-type' }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (request.method() !== 'GET') throw new Error('Unexpected API mutation')
    const status = url.pathname === '/workspace' ? workspaceStatus : 200
    calls.push([url.pathname, status])
    const json = status !== 200 ? {} : url.pathname === '/me' ? { id: returnedProfile } : {
      groups: [{ id: group, name: 'Grupo sintético', role, sport: 'futsal', default_players_on_court: 5 }],
      players,
    }
    // Keep the check in flight long enough for Chrome to lay out intermediate UI.
    return new Promise(resolve => setTimeout(resolve, 150)).then(() => route.fulfill({ json, headers, status }))
  })
  const page = await context.newPage()
  page.setDefaultTimeout(12_000)
  const phases = []
  const mainFrameNavigations = []
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) mainFrameNavigations.push(true) })
  page.on('console', message => {
    const match = /^futebol_session (\w+)$/.exec(message.text())
    if (match) phases.push(match[1])
  })
  await page.goto(origin)
  await page.getByRole('button', { name: 'Entrar com Sabará ID', exact: true }).click()
  const draft = page.getByRole('textbox', { name: /^Nome.*opcional/ })
  await draft.fill('Rascunho sintético')
  await page.getByText('Rascunho guardado neste dispositivo.').waitFor()
  await page.evaluate(() => {
    const read = () => ({
      scrollY, height: document.documentElement.scrollHeight,
      hidden: Boolean(document.querySelector('main > [hidden], [data-workspace-content][hidden]')),
      visibility: document.visibilityState, discarded: document.wasDiscarded === true,
    })
    window.resumeEvidence = { read, samples: [] }
    const sample = event => window.resumeEvidence.samples.push({ event, ...read() })
    document.addEventListener('visibilitychange', () => sample('visibilitychange'))
    window.addEventListener('pageshow', event => sample(event.persisted ? 'pageshow persisted' : 'pageshow'))
    new MutationObserver(records => {
      if (records.some(record => record.target.matches('[data-workspace-content], main > div'))) sample('hidden mutation')
    }).observe(document.querySelector('main'), { subtree: true, attributes: true, attributeFilter: ['hidden'] })
    window.scrollTo(0, 2600)
  })
  const before = await page.evaluate(() => window.resumeEvidence.read())
  assert.ok(before.scrollY > 1000)
  const beforeCalls = calls.length
  const beforePhases = phases.length
  const beforeNavigations = mainFrameNavigations.length
  const away = await context.newPage()
  await away.bringToFront()
  // Some automated Chrome sessions keep both tabs visible. Exercise the same listeners in that case.
  let actualTabVisibility = true
  try { await page.waitForFunction(() => document.visibilityState === 'hidden', { timeout: 1800 }) }
  catch {
    actualTabVisibility = false
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
      delete document.visibilityState
    })
  }
  await page.bringToFront()
  if (!actualTabVisibility) await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await page.waitForFunction(() => document.visibilityState === 'visible')
  await draft.waitFor()
  const after = await page.evaluate(() => window.resumeEvidence.read())
  const samples = await page.evaluate(() => window.resumeEvidence.samples)
  const report = { viewport, actualTabVisibility, before, after, samples, phases: phases.slice(beforePhases),
    calls: calls.slice(beforeCalls), navigations: mainFrameNavigations.length - beforeNavigations, serviceWorkers: context.serviceWorkers().length }
  console.log(JSON.stringify(report, null, 2))
  assert.equal(await draft.inputValue(), 'Rascunho sintético')
  assert.ok(Math.abs(after.scrollY - before.scrollY) <= 1)
  assert.equal(after.height, before.height)
  assert.ok(samples.every(sample => !sample.hidden && !sample.discarded))
  assert.deepEqual(report.phases, [])
  assert.deepEqual(report.calls, [])
  assert.equal(report.navigations, 0)

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
  assert.equal(calls.length, beforeCalls)

  workspaceStatus = 403
  await page.evaluate(() => {
    window.dispatchEvent(new Event('offline'))
    window.dispatchEvent(new Event('online'))
  })
  await page.getByText('Seu acesso ao espaço de trabalho não foi confirmado.').waitFor()
  assert.equal(await page.locator('input[name=name]').count(), 0)
  const blocked = await page.evaluate(() => window.resumeEvidence.read())
  assert.equal(blocked.scrollY, before.scrollY)
  assert.equal(blocked.height, before.height)
  workspaceStatus = 200
  await page.getByRole('button', { name: 'Tentar novamente' }).click()
  await draft.waitFor()
  const expectScrollRestored = async () => {
    await page.waitForFunction(y => Math.abs(scrollY - y) <= 1, before.scrollY, { timeout: 5_000 })
      .catch(async error => {
        console.log(JSON.stringify(await page.evaluate(() => ({
          scrollY, height: document.documentElement.scrollHeight,
          savedY: JSON.parse(sessionStorage.getItem('futebol.workspace-scroll.v1') ?? 'null')?.y,
        }))))
        throw error
      })
  }
  await expectScrollRestored()
  assert.equal(await draft.inputValue(), 'Rascunho sintético')

  const boot = async () => {
    const signIn = page.getByRole('button', { name: 'Entrar com Sabará ID', exact: true })
    const heading = page.getByRole('heading', { name: 'Quem joga hoje?' })
    await signIn.or(heading).first().waitFor()
    if (await signIn.isVisible()) await signIn.click()
    await heading.waitFor()
  }
  await page.reload()
  await boot()
  await draft.waitFor()
  await expectScrollRestored()
  assert.equal(await draft.inputValue(), 'Rascunho sintético')

  role = 'member'
  await page.reload()
  await boot()
  await page.getByText('Membro', { exact: true }).waitFor()
  assert.equal(await draft.count(), 0)
  assert.equal(await page.evaluate(() => scrollY), 0)
  role = 'owner'
  returnedProfile = 'd0000000-0000-0000-0000-000000000002'
  await page.reload()
  await boot()
  await draft.waitFor()
  assert.equal(await draft.inputValue(), '')
  assert.equal(await page.evaluate(() => scrollY), 0)
  console.log('PASS: pageshow persistido, 403 ambíguo, recarga, revogação e outra conta.')
} finally {
  await browser?.close()
  server.close()
}
