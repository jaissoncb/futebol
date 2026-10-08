/// <reference types="node" />
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

describe('data de calendário em fusos e perto da meia-noite', () => {
  it.each([
    ['America/Los_Angeles', '2026-01-02T00:01:00Z', '2026-01-01'],
    ['Pacific/Kiritimati', '2026-01-01T23:59:00Z', '2026-01-02'],
    ['UTC', '2026-01-01T23:59:00Z', '2026-01-01'],
    ['UTC', '2026-01-02T00:00:00Z', '2026-01-02'],
  ])('%s preserva a data local de %s', (timezone, instant, expected) => {
    // Separate processes avoid mutating the test runner's global timezone.
    const source = pathToFileURL(resolve('src/draw/local-date.ts')).href
    const result = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import { localDateInputValue } from ${JSON.stringify(source)}; process.stdout.write(localDateInputValue(new Date(${JSON.stringify(instant)})))`,
    ], { env: { ...process.env, TZ: timezone }, encoding: 'utf8', windowsHide: true })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(expected)
  })
})
