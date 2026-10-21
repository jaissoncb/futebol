// Not executed during preparation. Explicit --send + masked-stdin wrapper required.
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readSecretInput } from '../api/secret-input.ts'
import { prepareNeonDevUpload } from './prepare-neon-dev-upload.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const candidate = '.local-backup/neon-functions-20261019/candidate-WRWZHz'
export const candidateSha256 = '510bf79183fa4025d5ceb36849606b22cf845b4541d732888270cb98dc71202e'

export async function sendNeonDevUpload(input, transport) {
  const prepared = prepareNeonDevUpload(input)
  try {
    const response = await transport(prepared.url, prepared.init)
    // API bodies can contain environment snapshots. Do not read/print them.
    void response.body?.cancel().catch(() => undefined)
    return { status: response.ok ? 'accepted_check_console' : 'rejected_check_console', httpStatus: response.status }
  } catch {
    // An interrupted POST may have succeeded. Never retry automatically.
    return { status: 'unknown_check_console_before_retry' }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== '--send') throw new Error()
    const manifest = JSON.parse(await readFile(resolve(root, candidate, 'manifest.json'), 'utf8'))
    if (manifest.zip.sha256 !== candidateSha256) throw new Error()
    for (const file of manifest.stage1Files) {
      if (createHash('sha256').update(await readFile(resolve(root, file.path))).digest('hex') !== file.sha256) throw new Error()
    }
    const input = JSON.parse(await readSecretInput())
    if (input.config?.database?.runtimeRole !== 'futebol_api_dev_functions') throw new Error()
    const result = await sendNeonDevUpload({ ...input,
      zip: new Uint8Array(await readFile(resolve(root, candidate, 'function.zip'))), zipSha256: candidateSha256 }, fetch)
    console.log(JSON.stringify(result))
    if (result.status !== 'accepted_check_console') process.exitCode = 1
  } catch {
    console.log(JSON.stringify({ status: 'not_sent_invalid_local_input' }))
    process.exitCode = 1
  }
}
