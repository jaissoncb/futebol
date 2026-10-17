import { createApi, HttpError } from './server.ts'
import { AuthenticationError } from './auth.ts'

// Intentionally cannot connect to any DB or accept any token until G1/G3 evidence.
// Do not replace with unsigned JWT decoding, a prefix check or an env bypass.
const server = createApi({
  authenticate: () => Promise.reject(new AuthenticationError()),
  dispatch: () => Promise.reject(new HttpError(503, 'identity_evidence_pending')),
})
server.listen(8787, 'localhost', () => console.info('Futebol DEV API: http://localhost:8787 (identity gate closed)'))
