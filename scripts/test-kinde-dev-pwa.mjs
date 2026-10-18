import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, extname, sep } from 'node:path'
import { chromium } from 'playwright'

// Fresh, disposable browser: no real Kinde session, tokens, profiles or database.
// All third-party requests are blocked; the private API response is a fixture.
const root = resolve('dist-dev')
const evidencePath = 'D:/Projetos/_Handoff/Futebol/FUTEBOL_PWA_DEV_EVIDENCIAS_2026-10-18.json'
const fixture = 'FUTEBOL_PRIVATE_FIXTURE_NOT_CACHE'
const types = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
  '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' }
const server = createServer((request,response) => {
  void (async () => {
    const path = new URL(request.url, 'http://localhost').pathname
    const target = resolve(root, path === '/' ? 'index.html' : `.${path}`)
    if (!target.startsWith(root + sep)) { response.writeHead(404); response.end(); return }
    const body = await readFile(target)
    response.writeHead(200, {'Content-Type':types[extname(target)] ?? 'application/octet-stream','Cache-Control':'no-store'})
    response.end(body)
  })().catch(() => { response.writeHead(404); response.end() })
})
let browser
let stage = 'built_worker'
const tests = []
const pass = name => tests.push({name,status:'PASS'})
try {
  await readFile(resolve(root,'sw.js'))
  stage = 'local_static_server'
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(5173,'localhost',resolve) })
  const origin = 'http://localhost:5173'
  stage = 'isolated_browser'
  browser = await chromium.launch({headless:true,
    ...(existsSync(chromium.executablePath()) ? {} : {channel:'chrome'})})
  const context = await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'allow'})
  let mockPrivate = true
  await context.route('**/*',async route => {
    const url = new URL(route.request().url())
    if (url.origin === origin) return route.continue()
    if (url.origin === 'http://localhost:8787' && mockPrivate) return route.fulfill({status:200,
      headers:{'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':origin},
      body:JSON.stringify({privateFixture:fixture})})
    return route.abort()
  })
  const page = await context.newPage()
  stage = 'anonymous_document'
  await page.goto(origin,{waitUntil:'domcontentloaded'})
  stage = 'anonymous_ui'
  await page.getByRole('button',{name:'Entrar com Sabará ID',exact:true}).waitFor()
  stage = 'worker_ready'
  await page.evaluate(async () => { await Promise.race([navigator.serviceWorker.ready,
    new Promise((_,reject) => setTimeout(() => reject(new Error('worker_not_ready')),15000))]) })
  stage = 'worker_controller'
  await page.reload({waitUntil:'domcontentloaded'})
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller),{},{timeout:15000})
  pass(stage)
  stage = 'private_response_not_cached'
  assert.equal(await page.evaluate(async () => (await (await fetch('http://localhost:8787/me',{cache:'no-store'})).json()).privateFixture),fixture)
  const cache = await page.evaluate(async marker => {
    const names = await caches.keys()
    let entries = 0, privateCached = false, callbackCached = false
    for (const name of names) {
      const cache = await caches.open(name)
      for (const request of await cache.keys()) {
        entries++
        const url = new URL(request.url)
        if (url.port === '8787' || (await (await cache.match(request)).text()).includes(marker)) privateCached = true
        if (url.searchParams.has('code') || url.searchParams.has('state')) callbackCached = true
      }
    }
    return {entries,privateCached,callbackCached}
  },fixture)
  assert.ok(cache.entries > 0); assert.equal(cache.privateCached,false); assert.equal(cache.callbackCached,false)
  pass(stage)
  stage = 'offline_public_shell_and_private_request_denied'
  mockPrivate = false
  await context.setOffline(true)
  await page.reload({waitUntil:'domcontentloaded'})
  await page.getByRole('button',{name:'Entrar com Sabará ID',exact:true}).waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true)
  assert.equal(await page.evaluate(async () => { try { await fetch('http://localhost:8787/me'); return false } catch { return true } }),true)
  await page.screenshot({path:'D:/Projetos/_Handoff/Futebol/FUTEBOL_PWA_OFFLINE_2026-10-18.png',fullPage:true})
  pass(stage)
  stage = 'offline_oauth_query_not_served_from_shell_cache'
  let callbackDenied = false
  try { await page.goto(`${origin}/?code=fixture-only&state=fixture-only`,{waitUntil:'domcontentloaded',timeout:5000}) }
  catch { callbackDenied = true }
  assert.equal(callbackDenied,true)
  pass(stage)
  await writeFile(evidencePath,JSON.stringify({at:new Date().toISOString(),source:'isolated_built_pwa_fixture',
    realAuthentication:false,realDatabase:false,outboundServicesBlocked:true,cacheEntries:cache.entries,tests},null,2))
  console.log(JSON.stringify({status:'PASS',tests:tests.length,realAuthentication:false,realDatabase:false}))
} catch (error) {
  tests.push({name:stage,status:'FAIL'})
  await writeFile(evidencePath,JSON.stringify({at:new Date().toISOString(),source:'isolated_built_pwa_fixture',
    realAuthentication:false,realDatabase:false,tests},null,2))
  console.log(JSON.stringify({status:'FAIL',stage,errorClass:error instanceof Error ? error.name : 'unknown'})); process.exitCode=1
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
