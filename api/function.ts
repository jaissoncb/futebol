import { createTokenValidator } from './auth.ts'
import { createRuntimePool } from './database.ts'
import { createFetchHandler, jsonResponse } from './fetch-handler.ts'
import { createUserinfoProof } from './g3.ts'
import { createRestrictedDatabaseDispatch } from './routes.ts'
import { readRuntimeConfig } from './runtime-config.ts'

// Neon Functions entrypoint: default.fetch(Request). Nothing listens on a port.
// Lazily composed once per isolate; no connection, probe or migration at import.
let handler: ((request: Request) => Promise<Response>) | undefined
export default {
  async fetch(request: Request): Promise<Response> {
    if (!handler) {
      try {
        const { config, connectionString } = readRuntimeConfig(process.env)
        const authenticate = createTokenValidator(config.identity,
          createUserinfoProof({ timeoutMs: 5000 }, config.identity.userinfoUrl))
        const pool = createRuntimePool(connectionString, `futebol-functions-${config.environment}`)
        // pg can emit idle errors outside a request. Consume them without logging
        // raw errors/credentials; the next private operation still fails closed.
        pool.on('error', () => undefined)
        handler = createFetchHandler({ allowedOrigin: config.allowedOrigin, authenticate,
          dispatch: createRestrictedDatabaseDispatch(pool) })
      } catch {
        return jsonResponse(503, { error: 'service_unavailable' })
      }
    }
    return handler(request)
  },
}
