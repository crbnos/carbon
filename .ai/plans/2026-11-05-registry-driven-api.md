# The API runs from the service-function registry, not from the generated catalog

Status: plan, ready to execute on `dane/kind-pascal-e46y0e` after the two decisions
below are confirmed.

## Why

`tool-metadata.json` is build output of a ts-morph pass over the whole ERP (about
two minutes on 4 cores). The oRPC router under `/api/v1` is built from it at
startup, and the React Router dev server loads every route at boot, so the ERP
cannot start without the file. That is why `postinstall` runs the generator.

The runtime needs three things from it that only static analysis can see today:

| Need | Today | After |
|------|-------|-------|
| Which functions are published | the `@mcp` TSDoc tag | a `publish` option on `defineServiceFn` |
| The input schema | reflected from the TypeScript type | the function's own zod validator (`z.toJSONSchema` for docs) |
| Whether the result is a list | reflected from the return type | the result itself: a `paged()` result is marked, a list is an array |

Everything else the catalog holds is documentation: titles, descriptions,
`@param` text, response schemas, id lookups. The generator keeps producing it, on
release and in CI, as the OpenAPI source for the docs site and SDKs. Nothing in dev
waits on it.

## Facts the plan rests on (verified 2026-11-05)

- 1948 exported `defineServiceFn` consts; 1786 published (`@mcp` 757, `@mcp read`
  785, `@mcp destructive` 244); 162 unpublished, among them 10 `"system"` and 2
  keyed permissions, which the generator refuses anyway.
- `ServiceFn` exposes `input` (zod) and `permission` at runtime. The router
  (`apps/erp/app/modules/router.server.ts`) is a plain object of 18 namespaces,
  so `Object.entries` gives module, const name and function.
- Classification is derived from the permission literal: `view` only → READ, any
  `delete` → DESTRUCTIVE, else WRITE. `@mcp read` overrides for 17 functions
  (16 with `{}`, 1 with a constant); `@mcp destructive` overrides for 72.
- `paged()` returns a plain `{ rows, count }`; 131 functions use it. 139 inputs
  declare `limit` and `offset`; 8 of those are not paged (`people_getPeople`,
  `sales_getBaseCatalog`, …), so the input alone does not say "paged".
- 680 responses are lists; 130 of them are typed `T[] | null`.
- zod is 4.6.6 (`z.toJSONSchema` available, unused so far). `jsonSchemaInput`
  validates with `z.fromJSONSchema`; `jsonSchema()` is a pass-through for output.
- Runtime readers of the catalog: the v1 router, `callOperation` (MCP and the
  workflow dispatcher), the MCP route and `/.well-known/mcp.json`. The in-app agent
  does not read it. The docs site reads the JSON file at its own build.
- `COMPANY_TABLES` (every table with `companyId`) comes from the catalog; the
  generator reads it from `packages/database/src/types.ts`.

## Decisions

1. **`publish` is the option.** `defineServiceFn({ publish: true | "read" |
   "destructive", title, description?, input, output?, permission, run })`.
   `true` classifies from the permission; `"read"` and `"destructive"` override
   as the tag did. A `"system"` or keyed permission with `publish` is refused when
   the catalog is built. The `@mcp` tag goes away.
2. **Descriptions are registry fields, not comments.** `title` (required with
   `publish`) and `description` (optional prose for the agent) sit on the
   definition; field descriptions are `.describe()` on the zod fields. The MCP
   reads them from the object it dispatches from, so dev and production serve the
   same catalog and nothing can be stale. The `@param` and `@remarks` channels go
   away; a TSDoc block may stay for anything else, and the codemod removes the
   migrated parts. No IDE hover text: one copy, no drift.
3. **Lists are decided from the result until `output` is declared.** `paged()`
   marks its result; an array result goes out as `{ results, count }`, anything
   else bare. `callOperation` calls the service function directly. A `T[] | null`
   function that returns `null` now sends `null`. Phase 2 replaces this with a
   declared `output`.
4. **`paginates` for MCP paging comes from the input** (both `limit` and
   `offset` declared) until `output: paged(...)` declares it. The 8 non-paged
   operations that declare them get `call_tool`'s default `limit` of 25.
5. **The runtime never reads the generated catalog.** `OPERATIONS` is built from
   the registry only. Response schemas and id lookups are absent from the runtime
   until Phase 2 declares outputs; MCP `describe_tool` shows the input contract
   and the description. `tool-metadata.json` remains the docs and SDK artifact.
6. **Done: the digest check runs in CI only.** The lint job already runs
   `//#generate:mcp` for the workflow-catalog check and fails the pull request
   when the committed digest differs. Pre-commit runs neither.
7. **`postinstall` no longer runs the generator.** The ERP `build` script gets a
   `prebuild` that runs the turbo task, which covers Vercel; turbo's `build`,
   `test` and `typecheck` dependencies already cover CI.
8. **`COMPANY_TABLES` becomes a committed generated file**:
   `packages/database/src/company-tables.ts`, written by `pnpm generate:types`.
9. **Phase 2, after this lands: declared `output`.** `pnpm generate:types` emits
   zod row schemas per table and view (`.meta({ id })` set to the name, so the
   spec gets `$defs`); 131 paged functions get `output: paged(viewRow)`; the rest
   are seeded from the response schemas the current generator reflected; the
   compiler reports every `run` that disagrees. Then the generator is
   "import the registry, `z.toJSONSchema` per operation, write the spec" with no
   ts-morph, the digest becomes a diff of the committed spec, and id lookups move
   to `.meta({ lookup })` on the field or stay inferred by a cheap parser pass.

Speed, before and after Phase 1: `pnpm install` loses the generator (about 2 min
30 s on a cache miss); the ERP boots with no generated file; a service-function
change is live on the API and the MCP as soon as the dev server reloads; the
generator runs once per pull request in CI. After Phase 2 the generator itself
takes seconds.

## Tasks

### 1. `@carbon/api`: the option, the mark, the runtime catalog builder
- [x] `service-fn.server.ts`: add `publish?: true | "read" | "destructive"`,
      `title?: string`, `description?: string` to the definition; expose them on the
      returned function beside `input` and `permission`. A published function
      without a `title` is a type error.
- [x] `service-tools.server.ts`: `paged()` / `read(…, true)` return
      `{ rows, count, [PAGED]: true }`; export `isPaged(value)`.
- [x] New `packages/api/src/catalog.server.ts`: `buildOperationCatalog(router,
      { companyTables, docs? })` → `Operation[]`: name, module, path, classification,
      published permission (one module → `{ module, actions }`, else
      `{ module: null, actions: [] }`), `paginates`, lazy `schema` (zod →
      `z.toJSONSchema(input, { io: "input", unrepresentable: "any" })`, cached),
      and the docs fields when `docs` has the entry. Refuse `"system"` and keyed
      permissions, and a `publish: "read"` with a write action, as the generator
      does. Unit tests with a fixture router.
- [x] `ManifestEntry` stays the generated shape; `Operation` is `ManifestEntry` with
      `title`, `description`, `responseSchema`, `lookups` optional.

### 2. The ERP API and MCP read the registry
- [x] `operations.server.ts`: build `OPERATIONS` from `~/modules/router.server`
      and `COMPANY_TABLES` from `@carbon/database/company-tables`. Drop the JSON
      import. `shapeHttpBody` reads the result.
- [x] `router.server.ts`: `.input(fn.input)` (zod 4 is a Standard Schema), keep
      `jsonSchema()` on output with the lazy JSON schema for the spec.
- [x] `service-fn.server.ts`: unpack on `isPaged`, not on `meta.paginates`.
- [x] `call.server.ts`: run the service function directly (validation, tracing,
      context as before), return `{ data, count }`; delete `unshapeHttpBody`.
- [x] `mcp+/_index.ts` and `mcp+/lib/manifest.ts`: take the catalog from
      `operations.server`, not the JSON.
- [x] `openapi[.]json.ts`: unchanged; it renders the router.

### 3. The codemod and the generator
- [x] `scripts/codemod-publish.ts` (one-off, ts-morph): for each exported
      `defineServiceFn` const whose last TSDoc has `@mcp`, insert `publish`,
      `title` (the summary) and `description` (`@remarks` and `@returns` text) as
      the first properties; turn each `@param name - text` into `.describe(text)`
      on that field when the input is an inline object literal, else report it for
      a hand edit; delete the migrated parts of the doc block, keep any remainder.
      Verify: 1786 edits, 0 tags left, the runtime catalog's titles and
      descriptions equal the generator's for every operation, typecheck green.
      Delete the script afterwards.
- [x] `scripts/lib/service-fn-metadata.ts`: publication, the override, `title` and
      `description` from the literals; `@param` from `.describe()` only; a leftover
      `@mcp` tag fails generation with a message. Response schemas and lookups
      stay reflected until Phase 2.
- [x] `generate-db-types.ts`: write `company-tables.ts`.
- [x] `package.json`: `postinstall` without `//#generate:mcp`. No ERP `prebuild`:
      the runtime no longer imports the file, so a build does not need it.
- [x] Pre-commit: per decision 6.

### 4. Tests and docs
- [x] `mcp-service-fn-metadata.test.ts`: fixtures use `publish`.
- [x] `mcp-tool-permissions.test.ts`, `mcp-create-inputs.test.ts`,
      `company-scope.test.ts`, `manifest.test.ts`: read the runtime catalog, not the
      JSON (no artifact needed).
- [x] `catalog-search.test.ts`, `describe-format.test.ts`: keep reading the
      generated file (their fixtures need the reflected response schemas); the
      erp `test` task still depends on `//#generate:mcp` for them.
- [x] `service-fn.server.test.ts`, `orpc-mechanics.test.ts`: list shaping from the
      result and the mark.
- [x] Verified instead of a new test: the regenerated manifest equals the previous
      one for every title, description, classification, permission, response
      schema and lookup of all 1786 operations; one operation's `required` list
      changed order (`quality_updateRisk`), which moved its digest line once.
- [x] Rules and AGENTS: `module-files.md`, `conventions-services.md`,
      `mcp-tools-reference.md`, `packages/api/AGENTS.md`, every module AGENTS.md
      that says "tagged `@mcp`"; `.ai/lessons.md`.

### 5. Verify
- [ ] `pnpm dev` from a tree with no `tool-metadata.json`: the ERP boots, `GET
      /api/v1/openapi.json` answers, `POST /api/v1/sales/getCustomers` with an API
      key answers, MCP `search_tools` and `call_tool` work.
- [ ] `pnpm generate:mcp`, then the same calls show descriptions.
- [ ] `check:manifest` passes with the regenerated digest (the schema hashes move
      once, because the override now lives in the literal).
- [ ] Scoped typecheck, tests, Biome, the `@carbon/checks` suite.
