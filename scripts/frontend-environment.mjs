import { readFileSync } from 'node:fs'
import { validateFutebolEnvironment } from '../src/config/futebol-environment.ts'

export function getFrontendEnvironment(mode = 'production') {
  const environment = mode === 'futebol-dev' ? 'dev' : mode === 'production' ? 'prd' : null
  if (!environment) throw new Error('Modo do frontend publicável inválido.')
  return validateFutebolEnvironment(JSON.parse(readFileSync(
    new URL(`../deployment/frontend-${environment}.json`, import.meta.url), 'utf8')), environment)
}
