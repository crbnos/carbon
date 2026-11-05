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
   "destructive", input, permission, run })`. `true` classifies from the
   permission; `"read"` and `"destructive"` override as the tag did. A `"system"`
   or keyed permission with `publish` is refused when the catalog is built.
   The `@mcp` tag is removed by a codemod; the generator reads `publish` from the
   literal instead.
2. **Lists are decided from the result.** `paged()` marks its result with a
   symbol; `callServiceFn` unpacks `{ rows, count }` on that mark. The HTTP body is
   `{ results, count }` when the dispatch result is an array, bare otherwise.
   A `T[] | null` function that returns `null` now sends `null`, not
   `{ results: null }`. `callOperation` calls the service function directly, so
   nothing has to reverse the HTTP shape.
3. **`paginates` for MCP paging comes from the input**: both `limit` and `offset`
   declared. The 8 non-paged operations that declare them get a default `limit`
   of 25 from `call_tool` like the paged ones. Recorded as a known change.
4. **The release catalog enriches the runtime when present.** `OPERATIONS` is built
   from the registry; if `tool-metadata.json` exists it adds title, description,
   `@param` descriptions, `filters`/`sorts`, response schema and lookups by name.
   In production the build makes it (turbo `build` already depends on it); in dev
   it exists only after `pnpm generate:mcp`. MCP `describe_tool` and `search_tools`
   show less in dev without it.
5. **`COMPANY_TABLES` becomes a committed generated file**:
   `packages/database/src/company-tables.ts`, written by `pnpm generate:types`
   from the same CLI output as `types.ts`.
6. **Decided and done: the digest check runs in CI only.** The lint job already
   runs `//#generate:mcp` for the workflow-catalog check, so a "Manifest digest"
   step fails the pull request when the committed digest differs from the
   generated one. Pre-commit runs neither the generator nor the check. Lingui
   extract runs only when a staged change touches a message or a catalog.
7. **Open: `postinstall`.** Remove `//#generate:mcp` from it. The ERP `build`
   script gets a `prebuild` that runs the turbo task, which covers Vercel.

## Tasks

### 1. `@carbon/api`: the option, the mark, the runtime catalog builder
- [ ] `service-fn.server.ts`: add `publish?: true | "read" | "destructive"` to the
      definition; expose it on the returned function beside `input` and `permission`.
- [ ] `service-tools.server.ts`: `paged()` / `read(…, true)` return
      `{ rows, count, [PAGED]: true }`; export `isPaged(value)`.
- [ ] New `packages/api/src/catalog.server.ts`: `buildOperationCatalog(router,
      { companyTables, docs? })` → `Operation[]`: name, module, path, classification,
      published permission (one module → `{ module, actions }`, else
      `{ module: null, actions: [] }`), `paginates`, lazy `schema` (zod →
      `z.toJSONSchema(input, { io: "input", unrepresentable: "any" })`, cached),
      and the docs fields when `docs` has the entry. Refuse `"system"` and keyed
      permissions, and a `publish: "read"` with a write action, as the generator
      does. Unit tests with a fixture router.
- [ ] `ManifestEntry` stays the generated shape; `Operation` is `ManifestEntry` with
      `title`, `description`, `responseSchema`, `lookups` optional.

### 2. The ERP API and MCP read the registry
- [ ] `operations.server.ts`: build `OPERATIONS` from `~/modules/router.server`
      and `COMPANY_TABLES` from `@carbon/database/company-tables`; load
      `tool-metadata.json` with a dynamic `import()` in a try/catch for enrichment.
      Drop the static JSON import. `isListOperation` reads the response schema when
      present; `shapeHttpBody` reads the result.
- [ ] `router.server.ts`: `.input(fn.input)` (zod 4 is a Standard Schema), keep
      `jsonSchema()` on output with the lazy JSON schema for the spec.
- [ ] `service-fn.server.ts`: unpack on `isPaged`, not on `meta.paginates`.
- [ ] `call.server.ts`: run the service function directly (validation, tracing,
      context as before), return `{ data, count }`; delete `unshapeHttpBody`.
- [ ] `mcp+/_index.ts` and `mcp+/lib/manifest.ts`: take the catalog from
      `operations.server`, not the JSON.
- [ ] `openapi[.]json.ts`: unchanged; it renders the router.

### 3. The codemod and the generator
- [ ] `scripts/codemod-publish.ts` (one-off, ts-morph): for each exported
      `defineServiceFn` const whose last TSDoc has `@mcp`, insert `publish: true |
      "read" | "destructive"` as the first property and delete the tag line. Verify:
      1786 edits, 0 tags left, typecheck green. Delete the script afterwards.
- [ ] `scripts/lib/service-fn-metadata.ts`: publication and the override from the
      `publish` literal; a leftover `@mcp` tag fails generation with a message.
- [ ] `generate-db-types.ts`: write `company-tables.ts`.
- [ ] `package.json`: `postinstall` without `//#generate:mcp`; ERP `prebuild`.
- [ ] Pre-commit: per decision 6.

### 4. Tests and docs
- [ ] `mcp-service-fn-metadata.test.ts`: fixtures use `publish`.
- [ ] `mcp-tool-permissions.test.ts`, `mcp-create-inputs.test.ts`,
      `company-scope.test.ts`, `manifest.test.ts`: read the runtime catalog, not the
      JSON (no artifact needed).
- [ ] `catalog-search.test.ts`, `describe-format.test.ts`: keep the JSON (ranking
      needs descriptions); they run where the artifact exists.
- [ ] `service-fn.server.test.ts`, `orpc-mechanics.test.ts`: list shaping from the
      result and the mark.
- [ ] A new CI test: for every published operation, the generator's input schema and
      the runtime schema agree on `properties` and `required`.
- [ ] Rules and AGENTS: `module-files.md`, `conventions-services.md`,
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
