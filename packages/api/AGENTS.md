# @carbon/api

The Carbon API contract layer: `defineServiceFn` (one operation, with its input,
permission and body), the helpers a single-function leaf uses, the types for the
generated operation manifest, and the Standard-Schema wrapper that lets oRPC carry
precomputed JSON Schemas without a zod round-trip. Internal workspace package —
never published to npm.

## Always

- Treat `ManifestEntry` as the shape of the GENERATED manifest — the data itself is
  the erp app's gitignored `routes/api+/mcp+/lib/tool-metadata.json`, produced by
  `pnpm generate:mcp` (turbo root task `//#generate:mcp`; erp's and docs' `typecheck`/`build`/`test`
  depend on it). Change the generator (`scripts/lib/service-fn-metadata.ts`) and
  these types together.
- Keep `jsonSchema()` a pass-through validator (never rejects). It is the **output**
  wrapper: `shapeHttpBody` rewrites the HTTP body, so a correct response does not
  match the operation's declared response schema and validating it would reject
  real responses.
- `jsonSchemaInput()` is the **input** wrapper and DOES validate, via
  `z.fromJSONSchema` (zod is already a workspace dependency — no Ajv, no
  JSON-Schema validator library). Keep it permissive: unknown keys are
  preserved, not stripped (a service function's `z.looseObject` input reads
  them), and an unconvertible schema falls back to pass-through rather than
  failing every request to that operation.
- Keep `@orpc/openapi` imports in `schema.ts` type-only — it is a devDependency, and
  the runtime module must not pull it in.

## Never

- Hand-edit `tool-metadata.json` or `tool-manifest.digest.json` — both are generated;
  `pnpm check:manifest` (pre-commit gated) fails on a stale digest.
- Add runtime dependencies beyond the `@orpc/*` client-side packages and the ones
  the service-function layer needs (`@carbon/auth`, `@carbon/database`, `@carbon/kv`,
  `@carbon/logger`, `@carbon/utils`,
  `@supabase/supabase-js`) without asking.
- Import app code (`~/…`). An app hands in what is its own — its router and the
  context its callers run with — through `registerCarbon`, and its router's type
  through `Register` (`apps/erp/app/modules/carbon.server.ts`).

## Validation Commands

```bash
pnpm exec turbo run typecheck --filter=@carbon/api
pnpm --filter @carbon/api test
pnpm run check:manifest        # digest current?
```

## Key Exports

| Subpath | Provides |
|---------|----------|
| `.` (index) | Manifest types: `ManifestEntry`, `ToolPermission`, `Classification`, `PermissionAction`, and `SERVICE_RULE_ERROR_CODE` (re-exports `./schema` too). Client-safe |
| `./schema` | `jsonSchema()` pass-through Standard Schema wrapper, `CarbonJsonSchemaConverter` (OpenAPI generator plugin), `CARBON_VENDOR` |
| `./service-fn.server` | `defineServiceFn`, `CarbonError`, `ERROR_STATUS`, `createServiceContext`, `ServiceContext`, `Result`, `RouteResult`, `toResult`. `ctx.transaction` rolls back on a returned refusal — a bare `CarbonError` or a composed service function's `{ data, error }` — and returns it as the error. A failure log names the input's keys, never its values |
| `./carbon.server` | What a route calls: `carbon(request)` (the operations bound to the caller, typed through the app's `Register` augmentation), `carbonFor(auth)` (the same, for a caller the route authenticated another way, such as the Onshape panel's bearer token), `respond(request, result).redirect(to, { message, onError })`, `registerCarbon` (the app's router and context, called once from `entry.server.tsx` via `apps/erp/app/modules/carbon.server.ts`), `bindServiceFns` / `Api` |
| `./permissions` | `hasPermissions`, `permissionsFromClaims`, `resolvePermissions` and the `Permissions` / `PermissionRule` / `ModulePermissions` types. A keyed rule refuses a value with no rule of its own (an inherited key included) as `InvalidInputError` (400) naming the field; the `defineServiceFn` gate and `invokePosting` (`authorizePostingCaller`, ERP `shared.service.ts`) both check by these rules |
| `./errors` | `ServerFnError`, `InvalidInputError`, `ForbiddenError`, `NotFoundError`, `isDataLayerError`, `isServerFailure`, `toServerFnError`, `RAISED_EXCEPTION` — the postings' error classes. `isServerFailure` is the database or network failing, not the request: a Node system error (`connect ECONNREFUSED …`), `pg` / `pg-pool`'s connection errors, a SQLSTATE of class 08, 40, 53, 57, 58 or XX, Kysely's `NoResultError`. `toServerFnError` makes one a 500 with no message, whatever the default status |
| `./postings.server` | The postings `@carbon/jobs`, `@carbon/ee` and MES call, which cannot import the app: `PostingContract` (each posting's input, and the result its callers read), `registerPostings` (the app's implementations, from `apps/erp/app/modules/postings.server.ts` through `carbon.server.ts`), `posting` / `postingOrThrow`. A posting answers `{ data, error }` with the `ServerFnError` it refused with. Handles without `companyGroupId` have it read from the company. A new caller adds its posting to the contract; the ERP's registration then fails to typecheck until it implements it |
| `./postings` | Client-safe: the input schemas of the postings MES calls (`issueInput`, `postPickingInput`, `createInput`, …, plain zod with no app imports) and the results it reads, used by MES to type its calls and by the ERP to validate them; `MES_POSTINGS` / `isMesPosting`, the postings and `type` values the ERP's internal endpoint accepts from MES |
| `./internal-call` | `signInternalCall` / `verifyInternalCall`: a signed server-to-server call (HMAC-SHA256, key from HKDF over `SESSION_SECRET`, `INTERNAL_CALL_WINDOW_MS` of 5 minutes, a nonce the receiver must refuse to see twice). `assemblerCallbackToken` / `isAssemblerCallbackToken`: the token on the assembler's completion callback URL, an HMAC of the job id under `SESSION_SECRET` (minted by `@carbon/jobs`, checked in constant time by the ERP's `api+/assembler.callback.ts`; nothing stored). A receiver checks the headers first (`readInternalCallHeaders`), then reads the body with `readInternalCallBody`, which refuses more than `INTERNAL_CALL_MAX_BYTES` (1 MiB) before it verifies the signature. Server-only, but not named `.server`: MES services that client components import load it lazily, and React Router refuses a `.server` import anywhere in the client graph |
| `./service-tools.server` | What a single-function leaf does around the service it calls. `payload(ctx, input)` puts the caller's identity on a payload: `.forCreate()` (`companyId`, `createdBy`), `.forUpdate()` (`companyId`, `updatedBy`), `.forUpsert()` (both audit fields; the payload's shape decides which survives), `.for(operation)` (the same, with the operation known at run time) or `.build()` (`companyId` only), after any of `.withUser()` (`userId`), `.withGroup()` (`companyGroupId`) and `.withoutCompany()`. It overwrites every identity key (`companyId`, `companyGroupId`, `createdBy`, `updatedBy`) the payload already has — at the top level, one level down and in a list's rows — set or not; an update drops `createdBy` and a create drops `updatedBy`, so a payload never rewrites a record's creator. `userId` is set only with `.withUser()`, since some inputs name a target user with it. The result readers: `unwrap(ctx, ...results)` (one Supabase result gives its `data`, several give a tuple, the first error is returned as a `CarbonError`) and `paged` (`{ data, count }`). For a posting body, `run` (a throw becomes a `CarbonError` refusal) and `attempt` (the `{ data, error }` with the `ServerFnError` itself); `serverFnRefusal`, the one status → category mapping (`run` and the ERP's `fromServerFn` both use it). A programming error (`TypeError` & co.), a server failure (`isServerFailure`) or a thrown status of 500 or more is `internal` with its message withheld and logged; a plain `Error` stays the caller's refusal (`validation` at 500) with its message. A returned `{ error }` with SQLSTATE `P0001` (a `RAISE` in our SQL) is a `rule` refusal with its message |

## Consumers

- `apps/erp/app/routes/api+/v1+/lib/` — the oRPC router reads `ManifestEntry`
  and builds procedures with `jsonSchemaInput()` / `jsonSchema()`;
  `service-fn.server.ts` calls the operation through `serviceFn.path`, whose
  own gate checks the caller (there is no separate scope gate).
- `scripts/lib/service-fn-metadata.ts` + `scripts/lib/manifest-digest.ts` — the
  generator emits entries in this shape and hashes them for the digest.

## Cross-References

- `.claude/rules/mcp-tools-reference.md` — the manifest, the generator and the call path
- `.claude/rules/module-files.md` — where service functions live and how routes call them
- `.ai/plans/2026-09-07-orpc-completion.md` — D1 records why the manifest is one
  file here rather than per-module shards (deferred, with revisit triggers)
