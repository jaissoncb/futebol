import { readSecretInput } from '../api/secret-input.ts'
const targets = {
  dev: ['ancient-wildflower-55433050', 'futebol-dev-20261018', 'br-shiny-dust-bastckar', 'dev'],
  prd: ['withered-haze-60370136', 'futebol-prd', 'br-divine-sun-badnm7ch', 'production'],
}
const env = process.argv[2]
let stage = 'input'
try {
  if (!Object.hasOwn(targets, env)) throw Error()
  const key = await readSecretInput()
  if (!/^[!-~]{16,4096}$/.test(key)) throw Error()
  async function get(path, stageName, expected) {
    stage = stageName
    const response = await fetch('https://console.neon.tech/api/v2/projects/' + path, {
      method: 'GET', headers: { Authorization: 'Bearer ' + key }, redirect: 'error', signal: AbortSignal.timeout(20000),
    })
    console.log(JSON.stringify({ env, stage, http: response.status }))
    if (!expected.includes(response.status)) throw Error()
    if (response.status !== 200) { await response.body?.cancel(); return null }
    return response.json()
  }
  const [id, name, branch, branchName] = targets[env]
  const [other, , otherBranch] = targets[env === 'dev' ? 'prd' : 'dev']
  const { project } = await get(id, 'own_project', [200])
  if (project.id !== id || project.name !== name) throw Error()
  const { branch: data } = await get(id + '/branches/' + branch, 'own_branch', [200])
  if (data.id !== branch || data.name !== branchName) throw Error()
  const { function: fn } = await get(id + '/branches/' + branch + '/functions/futebolapi', 'own_function', [200])
  if (fn.slug !== 'futebolapi' || !fn.active_deployment?.id) throw Error()
  await get(other, 'cross_project', [403, 404])
  await get(other + '/branches/' + otherBranch + '/functions/futebolapi', 'cross_function', [403, 404])
  console.log(JSON.stringify({ env, status: 'verified', deployment: fn.active_deployment.id }))
} catch {
  console.log(JSON.stringify({ env, stage, status: 'blocked' }))
  process.exitCode = 1
}
