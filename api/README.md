# Futebol DEV API

Local runtime: Node 24 (TypeScript stripping) or compatible TS runner; `pnpm dev:api` binds only localhost:8787. No cloud deployment, paid runtime or Production settings. The default entry rejects all authentication pending Identity G1/G3. `/health` is public and reports the gate. Credentials are never needed for this entry.

`auth.ts` uses jose RS256/JWKS with exact issuer, audience, client, timestamps, lifetime and signed principal proof. The proof defaults to false with no environment override. Synthetic fixture proofs in tests are not Kinde evidence. Unknown keys are handled by jose fixed remote JWKS caching/rotation; token-provided key URLs are rejected.

`database.ts` uses a restricted runtime pool, verifies role capabilities and encloses bootstrap/context/all domain queries in one transaction. `set_config(..., true)` never escapes a transaction; failed rollback discards the connection. The server must run `assertRuntimeRole` before enabling database dispatch. Migration identity is separate. Remote DSN belongs only in runtime secret storage; no `.env`/Drive copies or Vite variables.

The database scripts are for a fresh explicitly selected DEV database. No script auto-selects remote resources. No old Supabase migration is executed. SQL identity context is trusted because only the API has the connection and exposes parameterized, fixed endpoints; a stolen runtime DB credential is outside that trust boundary. Group membership stays in PostgreSQL.

Architecture B remains selected. The official Neon external-provider guide documents JWKS/audience, but no evidence available here proves the complete issuer/client/positive-principal boundary in HTTP. No direct Data API or Neon Auth has been enabled. Documentation consulted 17/10/2026: https://neon.com/docs/data-api/custom-authentication-providers and https://docs.kinde.com/build/tokens/verifying-json-web-tokens/ .
