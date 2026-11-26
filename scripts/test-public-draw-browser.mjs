import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, devices } from 'playwright'

const config = JSON.parse(await readFile('deployment/frontend-dev.json', 'utf8'))
const { appOrigin, apiBaseUrl } = config
const slug = 'futebol-de-quinta-a7r3t9'
const link = appOrigin + '/s/?id=' + slug
const examples = process.argv[2]
const types = { html: 'text/html', js: 'text/javascript', css: 'text/css',
  svg: 'image/svg+xml', png: 'image/png', webmanifest: 'application/manifest+json' }
const server = createServer(async (request, response) => {
  const path = new URL(request.url, appOrigin).pathname
    .replace(/^\/$/, '/index.html').replace(/^\/s\/$/, '/s/index.html')
  if (!/^\/(?:index\.html|s\/index\.html|sw\.js|workbox-[\w-]+\.js|(?:assets|icons)\/[\w.-]+|favicon\.ico|manifest\.webmanifest)$/.test(path)) {
    response.writeHead(404).end(); return
  }
  try {
    const asset = await readFile('dist-dev' + path)
    response.writeHead(200, { 'Content-Type': types[path.split('.').at(-1)] ?? 'application/octet-stream' }).end(asset)
  } catch { response.writeHead(404).end() }
})

function fixture(sizes) {
  let index = 0
  return {
    groupName: 'Futebol de Quinta',
    matchDate: '2026-11-26',
    teams: sizes.map((size, team) => ({
      name: ['Azul', 'Vermelho', 'Verde'][team], color: ['blue', 'red', 'green'][team],
      players: Array.from({ length: size }, (_, offset) => {
        const n = ++index
        let name = 'Atleta ' + String(n).padStart(3, '0')
        if (sizes.length === 3 && sizes[0] === 5 && n === 1) name = "Lívia d'Ávila"
        if (sizes.length === 3 && sizes[0] === 5 && (n === 2 || n === 3)) name = 'Cauê'
        if (n === 6) name += ' — ' + 'Álvaro Çedilha'.repeat(4) + ' ⚽'
        if (n === 7) name += ' ' + '<em>Texto literal</em>'
        return { name, reserve: offset > 3, goalkeeper: offset === 0 }
      }),
    })),
  }
}

await new Promise((done, reject) => { server.once('error', reject); server.listen(5173, done) })
let browser
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  for (const [layout, options] of [
    ['desktop', { viewport: { width: 1360, height: 900 } }],
    ['Android emulado', devices['Pixel 7']],
    ['iOS emulado em Chromium', devices['iPhone 13']],
  ]) {
    const context = await browser.newContext({ ...options, acceptDownloads: true, serviceWorkers: 'allow' })
    let responseCode = 200
    let sizes = [5, 5, 3]
    let expireImmediately = false
    let lookups = 0
    const outside = []
    await context.route('**/*', async route => {
      const request = route.request()
      const url = new URL(request.url())
      if (url.origin === appOrigin) return route.continue()
      if (url.origin !== apiBaseUrl || url.pathname !== '/shared-draw' || url.search !== '?id=' + slug) {
        outside.push(url.origin + url.pathname)
        return route.abort()
      }
      assert.equal(request.method(), 'GET')
      assert.equal(request.headers().authorization, undefined)
      assert.equal(request.headers().referer, undefined)
      lookups++
      if (responseCode === 0) return route.abort('failed')
      return route.fulfill({
        status: responseCode,
        headers: { 'Access-Control-Allow-Origin': appOrigin, 'Cache-Control': 'no-store' },
        json: responseCode === 200
          ? { snapshot: fixture(sizes), expiresAt: new Date(Date.now() + (expireImmediately ? -1000 : 3600000)).toISOString() }
          : { error: 'publication_unavailable' },
      })
    })
    await context.addInitScript(({ nativeFiles }) => {
      window.fixturePaint = []
      window.fixtureSent = []
      window.fixtureClipboard = []
      const original = CanvasRenderingContext2D.prototype.fillText
      CanvasRenderingContext2D.prototype.fillText = function (value, ...args) {
        window.fixturePaint.push(value)
        return original.call(this, value, ...args)
      }
      Object.defineProperty(navigator, 'canShare', { value: data => nativeFiles && data.files?.[0]?.type === 'image/png' })
      Object.defineProperty(navigator, 'share', { value: async data => {
        window.fixtureSent.push({ text: data.text, url: data.url, mime: data.files?.[0]?.type })
        throw new DOMException('Fixture cancels share', 'AbortError')
      } })
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.fixtureClipboard.push(text) } } })
    }, { nativeFiles: layout !== 'desktop' })
    const page = await context.newPage()
    page.setDefaultTimeout(10000)
    const original = await page.goto(link)
    assert.equal(original.status(), 200)
    await page.getByRole('button', { name: 'Salvar imagem' }).waitFor()
    await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(b => b.textContent === 'Salvar imagem' && !b.disabled))
    assert.equal(await page.title(), 'Times definidos · Futebol')
    assert.deepEqual(await page.locator('.shared-team-count').allTextContents(), ['5 jogadores', '5 jogadores', '3 jogadores'])
    assert.equal(await page.getByRole('listitem').count(), 13)
    assert.equal(await page.getByText('Cauê', { exact: true }).count(), 2)
    assert.equal(await page.locator('.shared-team em').count(), 0)
    await page.getByRole('listitem').filter({ hasText: '<em>Texto literal</em>' }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), await page.evaluate(() => innerWidth))
    await page.getByText('Iniciar sessão', { exact: true }).waitFor({ state: 'hidden' })
    assert.equal(await page.locator('meta[name=robots]').getAttribute('content'), 'noindex, nofollow, noarchive')
    assert.equal(await page.locator('meta[name=referrer]').getAttribute('content'), 'no-referrer')
    const whatsapp = page.getByRole('link', { name: 'Texto e link no WhatsApp' })
    const message = new URL(await whatsapp.getAttribute('href')).searchParams.get('text')
    assert.ok(message.includes(link) && message.includes('Lívia d\'Ávila (goleiro)'))
    await page.getByRole('button', { name: 'Copiar mensagem' }).click()
    assert.deepEqual(await page.evaluate(() => window.fixtureClipboard), [message])
    await page.getByRole('button', { name: 'Copiar link', exact: true }).click()
    assert.deepEqual(await page.evaluate(() => window.fixtureClipboard), [message, link])
    if (layout === 'desktop') {
      assert.equal(await page.getByRole('button', { name: 'Compartilhar imagem, texto e link' }).count(), 0)
      await page.getByText(/salve a imagem e cole a mensagem/).waitFor()
      await page.addScriptTag({ path: createRequire(import.meta.url).resolve('axe-core') })
      const violations = await page.evaluate(async () => (await axe.run({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(rule => rule.id))
      assert.deepEqual(violations, [])
    } else {
      await page.getByRole('button', { name: 'Compartilhar imagem e link', exact: true }).click()
      await page.getByText('Compartilhamento cancelado.', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Compartilhar imagem, texto e link' }).click()
      await page.getByText('Compartilhamento cancelado.', { exact: true }).waitFor()
      assert.deepEqual(await page.evaluate(() => window.fixtureSent), [
        { text: undefined, url: link, mime: 'image/png' },
        { text: message, url: undefined, mime: 'image/png' },
      ])
      assert.deepEqual(await page.evaluate(() => window.fixtureClipboard), [message, link])
    }
    const downloadEvent = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Salvar imagem' }).click()
    const download = await downloadEvent
    assert.equal(download.suggestedFilename(), 'futebol-times.png')
    const png = await readFile(await download.path())
    assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a')
    assert.equal(png.readUInt32BE(16), 1200)
    if (examples && layout === 'desktop') await page.screenshot({ path: resolve(examples, 'FUTEBOL_SORTEIO_PUBLICO_DESKTOP_2026-11-26.png'), fullPage: true })
    if (examples && layout === 'Android emulado') {
      await page.screenshot({ path: resolve(examples, 'FUTEBOL_SORTEIO_PUBLICO_MOBILE_2026-11-26.png'), fullPage: true })
      await download.saveAs(resolve(examples, 'FUTEBOL_SORTEIO_ESCALACAO_PNG_2026-11-26.png'))
    }

    const beforeReload = lookups
    assert.equal((await page.reload()).status(), 200)
    await page.getByText('Lívia d\'Ávila (goleiro)', { exact: true }).waitFor()
    assert.ok(lookups > beforeReload)
    responseCode = 404
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
    await page.getByText(/pode estar incorreto, expirado ou revogado/).waitFor()
    assert.equal(await page.getByRole('listitem').count(), 0)
    responseCode = 0
    await page.reload()
    await page.getByText(/Verifique sua conexão/).waitFor()
    responseCode = 200
    await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click()
    await page.getByText('Lívia d\'Ávila (goleiro)', { exact: true }).waitFor()
    expireImmediately = true
    await page.reload()
    await page.getByText(/pode estar incorreto, expirado ou revogado/).waitFor()
    expireImmediately = false

    if (layout === 'desktop') {
      for (const groupSizes of [[5, 5], [4, 4, 4], [5, 4, 4], [40, 40, 40]]) {
        sizes = groupSizes
        await page.reload()
        await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(b => b.textContent === 'Salvar imagem' && !b.disabled))
        const snapshot = fixture(sizes)
        assert.deepEqual(await page.locator('.shared-team-count').allTextContents(), sizes.map(size => size + ' jogadores'))
        assert.equal(await page.getByRole('listitem').count(), sizes.reduce((total, size) => total + size))
        const paint = await page.evaluate(() => window.fixturePaint.join(' '))
        for (const team of snapshot.teams) {
          for (const player of team.players) assert.ok(paint.includes(player.name.split(' — ')[0].split(' <')[0]), player.name)
        }
        assert.ok(paint.includes(link))
      }

      await page.goto(appOrigin)
      await page.evaluate(() => navigator.serviceWorker.ready)
      await page.reload()
      await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
      await page.goto(link)
      await page.getByText('Futebol de Quinta', { exact: true }).waitFor()
      const cached = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async name =>
        (await (await caches.open(name)).keys()).map(({ url }) => url)))).flat())
      assert.ok(cached.length > 0)
      assert.ok(!cached.some(url => url.includes('/shared-draw') || url.includes('?id=')))
    }
    assert.deepEqual(outside, [])
    await context.close()
    console.log('PASS: ' + layout + ' – URL direta, recarga, escalação, compartilhamento e remoção após consulta.')
  }
} finally {
  await browser?.close()
  server.closeAllConnections()
  await new Promise((done, reject) => server.close(error => error ? reject(error) : done()))
}
