# Futebol API — registros de implementação DEV

> Estado vigente: frontend em GitHub Pages, Sabará ID/Kinde e API em Neon
> Functions com Neon PostgreSQL, nos ambientes DEV e PRD existentes.
> Operação e credenciais: [OPERATIONS.md](../deployment/OPERATIONS.md).
> Release e rollback: [RELEASE.md](../deployment/RELEASE.md).
> As etapas abaixo são registros históricos; referências a PRD não implantado
> ou preparação pendente não descrevem o estado atual. Não repetir provisionamento.

## Local Neon Functions port (stage 1, not deployed)

The explicit Function entrypoint is `api/function.ts`, a default object with
`fetch(Request): Promise<Response>`. It composes once per isolate with the existing
RS256/JWKS validator, G3 userinfo proof, pg pool and REST database dispatch. It does
not start `node:http` or import the DEV runners, probes, evidence files, native
HTTPS experiment, migrations or secret-input scripts. Frontend and CI are unchanged.

Configuration is read only from the operator-controlled process environment:

- `FUTEBOL_RUNTIME_CONFIG`: complete JSON metadata matching `RuntimeConfig` in
  `runtime-config.ts`. Required keys: `environment` (`dev` or `prd`), `allowedOrigin`
  (one exact origin, no trailing slash), `identity`, `database`. No defaults.
- `identity`: `issuer`, `audience`, `clientId`, `jwksUri`, `userinfoUrl`,
  `maxLifetimeSeconds: 600`, `lifetimeRoundingSeconds: 1`. DEV must match the existing
  Futebol Test contract in `g3.ts`. PRD requires its own explicit approved metadata;
  Test issuer/audience/client and loopback origins are refused. This validation
  does not certify an as-yet unapproved PRD contract. JWKS/userinfo must be the fixed
  paths on the configured HTTPS issuer origin; no request/claim selects endpoints.
- `database`: exact `pooledHost`, `unpooledHost`, `name`, `runtimeRole`. Frankfurt
  Neon endpoint pair (`ep-…-pooler.c-….eu-central-1.aws.neon.tech` and the same host
  without `-pooler`); database `futebol_<environment>` and login
  `futebol_api_<environment>_<suffix>`. These naming rules deliberately require
  explicit environment separation. DEV and PRD must use different destinations.
- **Replace both** `DATABASE_URL` and `DATABASE_URL_UNPOOLED` in the future runtime's
  authenticated secrets interface with the same restricted login/password, exact
  database and corresponding hosts. Both require `sslmode=verify-full`; optional
  `channel_binding=require` is allowed. Other parameters, duplicates, mismatched
  passwords/users/targets and missing URLs fail closed. A custom Futebol URL alone
  is insufficient: the unused injected unpooled credential must also be restricted.

No DSN, password or deploy token belongs in JSON metadata, source, argv, `.env`,
Vite variables, logs or Handoff. No PRD sample/fallback is supplied. Static URL
checks cannot prove live privileges or the absence of other administrative secrets;
the future DEV check must verify effective process configuration without printing it.

Pool construction is lazy and does not connect. On the first authenticated,
body-validated private request, `assertRuntimeRole` and `assertDatabaseBoundary`
must both succeed before `withActor`, bootstrap or domain SQL can run. Concurrent
requests share that readiness promise; failure returns sanitized 503 and a later
request can retry the checks. The role check also requires membership in
`futebol_runtime` and refuses an absent/null safety result. The existing actor
transaction, local `set_config`, RLS, grants, locks and save UUID are unchanged.
Role/boundary readiness is per pool/isolate, not a continuous privilege audit.

Only the pooled URL is used. Pool max 5, verified TLS and DB timeouts are retained;
the pool lives across requests, has a silent idle-error listener and is never
closed per request. G3 uses native fetch with a hard five-second timeout, positive
cache <=60 seconds/exp, max 1024 confirmations and eight remote proofs. No stale
fallback. All responses are no-store with sanitized errors. CORS uses the one
configured origin; no Origin header still requires G3 for private requests.
OPTIONS advertises the existing methods/headers. Body parsing follows authentication,
requires exact `application/json`, enforces 256 KiB on streamed bytes and a 20-second
body-read timeout, and stops before dispatch on abort. `/health` returns only
`{ "status": "ok" }`; it is liveness, not proof of DB readiness or remote G3.

`/__dev` and its descendants plus diagnostic query controls (`__dev*`, `phase`,
`mode`, `transport`, `trial`, `stabilize`) return 404 before dispatch. The handler
has a shared per-isolate 120-request/minute budget and eight active-request cap;
it never derives identity/limits from proxy headers. These are bounded local
controls, not distributed rate limits. 429 includes Retry-After: 60; identity
dependency failure remains 503 / Retry-After: 2. No automatic write retry is added.

Local verification uses the existing lint/typecheck and Node test runner. New
tests cover the fetch edge, explicit configuration, restricted readiness and the
entrypoint's source import graph. They use synthetic keys/streams/pool doubles;
they do not prove Neon bundling, live TLS/roles/RLS, Kinde uptime or billing.
The current frontend's 20-second total deadline is unchanged: JWKS + userinfo +
connection + SQL can exceed it on cold start. The future DEV stage must measure
that envelope and any uncertain save result using the same idempotent UUID;
an indispensable frontend adjustment needs its own approval.

Before a separately authorized DEV run: confirm Free/US$0 and the exact existing
DEV branch/destination; approve complete metadata; prepare a dedicated restricted
login by the authorized administrative procedure, outside the Function; replace
both injected URLs using secrets storage; package only the explicit entrypoint and
its runtime dependencies with the platform's Node 24 bundler. Inspect that candidate
bundle, then run a short real smoke of initial/renewed G3, cache/TTL, negatives,
`/me`, cold connection, effective role/grants/RLS, actor isolation and one idempotent
save/history. Verify the unused unpooled URL is restricted too. Do not run migrations,
empty-database fixtures, or the experimental DEV runners against preserved data.
Record only sanitized outcomes/timings and the candidate digest. No remote execution,
credential access, deployment or Functions DEV PASS is part of stage 1.

## Existing DEV entrypoints

Local runtime: Node 24 (TypeScript stripping) or compatible TS runner; `pnpm dev:api` binds only localhost:8787. No cloud deployment, paid runtime or Production settings. The default entry rejects all authentication pending G3/Neon evidence. `/health` is public and reports the gate. Credentials are never needed for this entry.

`auth.ts` uses jose RS256/JWKS with exact issuer, audience, client, timestamps, lifetime and signed principal proof. The proof defaults to false with no environment override. Synthetic fixture proofs in tests are not Kinde evidence. Unknown keys are handled by jose fixed remote JWKS caching/rotation; token-provided key URLs are rejected.

`g3.ts` implements the accepted 18/10/2026 Test contract: fixed public issuer/audience/client/JWKS/userinfo, 600 s lifetime plus exactly 1 s observed rounding, 30 s clock skew (but exp must still be future), every present gty denied, amr array including pwd, finite chronological auth_time. The SAME Bearer must receive 200 JSON with matching sub at userinfo. Wrong token/profile 400/401/403/sub mismatch => 401; unavailable/malformed/429/5xx => 503 with Retry-After: 2. Whole-request timeout defaults to two seconds, bounded at five; DEV diagnostic/runtime use five after two real two-second timeouts. 64 KiB streaming limit, no redirects. Positive SHA-256 token/context cache only in process memory, max 1024 entries, <=60 s and exp bound, eight concurrent remote requests with same-token deduplication. Signature/claims and downstream disabled-user/RLS checks remain per request. No stale fallback or negative-to-positive conversion. Dependency failures expose only classification/timing, never provider errors.

`pnpm dev:g3` is an explicit alternative diagnostic entry on the same port, NEVER parallel to dev:api. It accepts only `GET /__dev/g3?phase=...` after G3 validation, imports no DB module and keeps /me/data closed. It appends only allowlisted labels, booleans and timing evidence to the Handoff JSONL, without subjects, JWTs or profile bodies. The frontend button starts initial, ID-negative, cache and 61-second TTL probes; only a successful SDK tokenRefreshed event supplies the refreshed access directly from memory. No manual refresh control. Missing amr/auth_time on refresh is a blocking failure; diagnostic success never enables data. Stop the diagnostic after the test.

Real initial/SDK-automatic Test access + matching userinfo passed on 18/10, including amr/auth_time in renewed access. Native Neon restricted login/pool/RLS tests also passed. `dev-readiness.ts` requires those exact local sanitized evidence records before the separate database entry can start; they never replace per-request crypto/userinfo/RLS.

Operator entry: `pwsh -NoProfile -File scripts/neon-dev-secure-input.ps1 -Mode api`. Credentials go only through masked input/stdin. `scripts/start-neon-dev.ts` is a separate migration provisioner: fixes target to the observed Free DEV endpoint, creates a random minimal login, runs additional domain/20-save/lock/injection fixtures and cleans only those fixtures transactionally. The HTTP child receives only the restricted DSN over stdin and a minimal Windows environment. Migration credentials never enter the HTTP child. `runtime-dev.ts` asserts role and current RLS/ownership/PUBLIC boundary before listening; every request uses the full G3 pipeline and withActor transaction. On shutdown the provisioner removes its own ephemeral login; actual DEV application data stays in Neon. Closing the window/signals stop the owned child and attempt cleanup, with sanitized evidence.

On 18/10/2026 the operator supplied fresh masked input, the seven native tests and five additional domain stages passed, and this restricted entry started. Real /me, group/player creation, draw save/history and immutable snapshots passed against Neon DEV. These observations live in the sanitized Handoff, not reusable credentials. Do not create `.env`, argv/environment DSNs, browser credential forms, paid resources or Production settings to replace operator input. Default dev:api remains closed. Do not rerun the fresh-database native suite against retained application data. The running provisioner owns cleanup of its temporary login after the HTTP child exits.

After a simultaneous old test window overwrote native evidence while domain fixtures were active, startup correctly refused the latest failed native check. The masked helper now holds a named Windows mutex during execution. If native evidence is missing/failed, the provisioner first requires complete G3 evidence, runs the native suite through a separate stdin child, and rechecks the complete G3+seven-native readiness before domain provisioning. The native empty-database check still refuses app data; no gate is bypassed. Native evidence also gets a JSONL history. Child stdin is consumed asynchronously with a 16 KiB bound. Runtime startup stages and child exit codes are recorded without credentials, and nonzero child exits propagate failure.

`database.ts` uses a restricted runtime pool, verifies role capabilities and encloses bootstrap/context/all domain queries in one transaction. `set_config(..., true)` never escapes a transaction; failed rollback discards the connection. The server must run `assertRuntimeRole` before enabling database dispatch. Migration identity is separate. Remote DSN belongs only in runtime secret storage; no `.env`/Drive copies or Vite variables.

The database scripts are for a fresh explicitly selected DEV database. No script auto-selects remote resources. No old Supabase migration is executed. SQL identity context is trusted because only the API has the connection and exposes parameterized, fixed endpoints; a stolen runtime DB credential is outside that trust boundary. Group membership stays in PostgreSQL.

Architecture B remains selected. The official Neon external-provider guide documents JWKS/audience, but no evidence available here proves the complete issuer/client/positive-principal boundary in HTTP. No direct Data API or Neon Auth has been enabled. Documentation consulted 17/10/2026: https://neon.com/docs/data-api/custom-authentication-providers and https://docs.kinde.com/build/tokens/verifying-json-web-tokens/ .

Directed B1/B2/B3 stabilization: `pwsh -NoProfile -File scripts/neon-dev-secure-input.ps1 -Mode stabilize` requires existing real readiness and fresh masked operator input. It NEVER runs the empty-database/native suite, migrations or domain fixtures. It rotates only the ephemeral restricted login, reasserts the runtime boundary and self-closes after 20 minutes so the provisioner can drop that login normally. Existing fictitious data remains intact. No token/DSN environment switch can open authentication.

The explicit stabilization entry adds a capped diagnostic GET (16 uncached attempts per process) using the full G3 contract. Zero positive-cache TTL forces remote confirmation; the normal cache stays bounded at 60 seconds/exp. Events contain only durations, phase (headers/body), allowlisted transport category and numeric HTTP status, never raw errors/IPs/provider bodies. The delayed workspace read is GET-only, still G3/RLS, and delays its already-read result eight seconds to test cancellation on logout; no writes are delayed/retried.

`scripts/observe-kinde-dev-network.ts` measures four fixed public Test JWKS samples (DNS/TLS/native HTTPS/fetch) without credentials or OS changes. It is not userinfo proof or a release SLA. External execution needs the normal one-command approval; do not run it as a sandbox-network workaround.

Optional directed comparison: the same masked helper with `-Mode transport` runs for five minutes, requires the existing readiness and preserves application data. It compares the normal fetch transport with fixed-Test-URL native HTTPS using a fresh socket, normal verified TLS, the same Bearer and complete G3. The panel performs three cycles, separated by 61 seconds, alternating which uncached transport goes first. The normal cached path in this explicit trial uses native HTTPS with the same 60-second/exp bound. This is an explicit DEV candidate, never an automatic fallback after failed authorization. Default runtime transport is unchanged. Record unavailable and successful samples separately; no small sample establishes a provider SLA.
