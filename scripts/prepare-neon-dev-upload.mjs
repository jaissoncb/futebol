// Pure preparation only: intentionally no fetch, HTTP client, stdin or CLI entry.
// A future separately authorized operator must supply secrets from masked input.
import { createHash } from 'node:crypto'
import { readRuntimeConfig } from '../api/runtime-config.ts'

export const target = Object.freeze({ organizationId: 'org-steep-math-64054637',
  projectId: 'ancient-wildflower-55433050', branchId: 'br-shiny-dust-bastckar', slug: 'futebolapi' })

export function prepareNeonDevUpload({ config, password, apiKey, zip, zipSha256 }) {
  try {
    if (config?.environment !== 'dev' || config.database?.name !== 'futebol_dev'
      || config.database?.pooledHost !== 'ep-small-voice-baiso0c9-pooler.c-8.eu-central-1.aws.neon.tech'
      || config.database?.unpooledHost !== 'ep-small-voice-baiso0c9.c-8.eu-central-1.aws.neon.tech'
      || !/^futebol_api_dev_[a-z0-9_]{1,40}$/.test(config.database?.runtimeRole ?? '')
      || typeof password !== 'string' || !password || password.length > 4096
      || typeof apiKey !== 'string' || !apiKey || /[\r\n]/.test(apiKey)
      || !(zip instanceof Uint8Array) || zip.length === 0
      || !/^[a-f0-9]{64}$/.test(zipSha256 ?? '')
      || createHash('sha256').update(zip).digest('hex') !== zipSha256) throw new Error()
    const dsn = host => {
      const url = new URL(`postgresql://${host}/${config.database.name}?sslmode=verify-full`)
      url.username = config.database.runtimeRole; url.password = password
      return url.href
    }
    // Exact allowlist: the management API token can never be a runtime variable.
    const environment = { FUTEBOL_RUNTIME_CONFIG: JSON.stringify(config),
      DATABASE_URL: dsn(config.database.pooledHost), DATABASE_URL_UNPOOLED: dsn(config.database.unpooledHost) }
    readRuntimeConfig(environment)
    const body = new FormData()
    body.set('zip', new Blob([zip]), 'function.zip')
    body.set('runtime', 'nodejs24')
    body.set('environment', JSON.stringify(environment))
    return { url: `https://console.neon.tech/api/v2/projects/${target.projectId}/branches/${target.branchId}/functions/${target.slug}/deployments`,
      init: { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` },
        body, redirect: 'error', signal: AbortSignal.timeout(30000) } }
  } catch {
    throw new Error('invalid_neon_dev_upload')
  }
}
