# Neon Functions DEV — implementation record

The existing `futebolapi` DEV Function was deployed on 19 October 2026 and its
authenticated smoke passed on 21 October. No Production deployment is approved.
The temporary management key was revoked, as confirmed by the user.

`neon-dev.runtime-config.json` contains public metadata only. Its role placeholder
is intentionally invalid. `neon-dev.sources.json` records the twelve validated
source hashes. Neither file contains credentials or a runnable deployment request.
The existing Function sources are preserved byte for byte.

Local checks (Node 24, existing application dependencies):

```powershell
node --test api/tests/fetch-handler.test.ts api/tests/runtime-config.test.ts api/tests/function-database.test.ts scripts/neon-function-package.test.mjs scripts/neon-functions-operator.test.mjs
```

The operator's candidate-integrity test also needs the original ignored candidate
directory referenced in `send-neon-dev-upload.mjs`. It is an archival check, not a
portable deployment mechanism. ZIPs, local manifests and private harnesses stay
outside Git. Do not rerun provisioning, upload or the completed remote smoke.

To reproduce a **local bundle**, use Node 24 and the application lockfile. The
separate, ignored `.tools/neon-functions` installation used
`@neon/config-runtime` 1.10.1, esbuild 0.28.2 and fflate 0.8.3. Install these exact
versions there with install scripts disabled only when network access is separately
authorized. Then run `node scripts/build-neon-function.mjs`. It checks the committed
source hashes and runtime graph and writes a new ignored candidate; it never
deploys. ZIP timestamps can change the ZIP hash even when executable bytes match.

The historical wrappers are retained for traceability. They require an explicit
operator action and private input; they are not part of the frontend or CI build.
Any future use needs new authorization for the exact remote operation.
