// Local preparation only. No SQL client, process launch, credentials or network.
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function validateDatabaseTarget(target) {
  const fixed = { organizationId: 'org-steep-math-64054637', projectId: 'withered-haze-60370136',
    project: 'futebol-prd', branch: 'production', database: 'futebol_prd', migrationRole: 'neondb_owner',
    runtimeRole: 'futebol_api_prd_functions', postgresMajor: 17, region: 'aws-eu-central-1', plan: 'Free', monthlyUsd: 0 }
  const pending = ['branchId', 'endpointId', 'unpooledHost', 'pooledHost', 'bindingConfirmed']
  const reject = () => { throw new Error('invalid_prd_database_target') }
  if (!target || typeof target !== 'object'
    || Object.keys(target).sort().join(',') !== [...Object.keys(fixed), ...pending].sort().join(',')
    || Object.entries(fixed).some(([key, value]) => target[key] !== value)) reject()
  if (pending.some(key => target[key] === null || key === 'bindingConfirmed' && target[key] === false)) {
    return { ready: false, missing: pending.filter(key => target[key] === null || key === 'bindingConfirmed' && target[key] === false) }
  }
  if (target.bindingConfirmed !== true || !/^br-[a-z0-9-]+$/.test(target.branchId)
    || !/^ep-[a-z0-9-]+$/.test(target.endpointId)
    || !/^ep-[a-z0-9-]+\.c-\d+\.eu-central-1\.aws\.neon\.tech$/.test(target.unpooledHost)
    || !target.unpooledHost.startsWith(`${target.endpointId}.c-`)
    || target.pooledHost !== target.unpooledHost.replace('.c-', '-pooler.c-')
    || target.branchId === 'br-shiny-dust-bastckar'
    || target.endpointId === 'ep-small-voice-baiso0c9') reject()
  return { ready: true, missing: [] }
}

export const migrations = Object.freeze([
  ['001_identity.sql', 'b5646d6ba5aa7a4e74ac0badb6e0886e92842aa339f9e5b1adefb5081fa14c75'],
  ['002_domain.sql', '32b8a2ba7cc339c70d1d5079798661be467a9e7c1a0251cbb7c0ce6cba6a2d66'],
  ['003_security.sql', '99bef4d92e09989925f4af06a35a9182e5c01c092aff3bbc5f1b1b37b196d018'],
  ['004_save_match_draw.sql', 'c09f64a6f4cefade06f6f5b3251f93afe652f50e43b649fab29c3b2fc96414e0'],
  ['005_database_boundary.sql', 'c2fdf86a763bbd703985048452f17d4f426d943f5c1ed502353391587ee9fd97'],
])

export async function prepareDatabase(root = resolve(import.meta.dirname, '..')) {
  const target = JSON.parse(await readFile(resolve(root, 'deployment/neon-prd.database-target.json'), 'utf8'))
  const status = validateDatabaseTarget(target)
  for (const [name, hash] of migrations) {
    if (createHash('sha256').update(await readFile(resolve(root, 'database', name))).digest('hex') !== hash) {
      throw new Error('migration_integrity_rejected')
    }
  }
  const runtime = JSON.parse(await readFile(resolve(root, 'deployment/neon-prd.runtime-config.json'), 'utf8'))
  if (runtime.environment !== 'prd' || runtime.database.name !== target.database
    || runtime.database.runtimeRole !== target.runtimeRole
    || ['pooledHost', 'unpooledHost'].some(key => runtime.database[key] !== target[key])) {
    throw new Error('prd_database_config_mismatch')
  }
  return { status: status.ready ? 'target_prepared_not_authorized' : 'blocked_missing_public_metadata',
    missing: status.missing, migrations: '5_hashes_pass', network: false,
    passwordActivationReady: false,
    // Public arguments for future review only; nothing is launched.
    futureInitializeArguments: status.ready ? ['-X', '-W', '--set=ON_ERROR_STOP=1',
      '--dbname', `host=${target.unpooledHost} port=5432 dbname=futebol_prd user=neondb_owner sslmode=verify-full`,
      '--file', resolve(root, 'deployment/neon-prd-initialize.psql')] : null }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2) throw new Error('unexpected_arguments')
    console.log(JSON.stringify(await prepareDatabase()))
  } catch {
    console.log(JSON.stringify({ status: 'local_preparation_rejected', network: false }))
    process.exitCode = 1
  }
}
