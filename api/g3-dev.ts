import { appendFileSync } from 'node:fs'
import { createG3Probe } from './g3-probe.ts'

// Fixed DEV-only output; event fields are booleans, timings and allowlisted labels.
const evidencePath = 'D:/Projetos/_Handoff/Futebol/FUTEBOL_G3_EVIDENCIAS_2026-10-18.jsonl'
const server = createG3Probe(event => {
  appendFileSync(evidencePath, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`, { encoding: 'utf8' })
})
server.listen(8787, 'localhost', () => console.log('Futebol G3 DEV diagnostic ready; data gate closed'))
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  server.closeAllConnections(); server.close()
})
