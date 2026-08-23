# Activepieces Pieces in Carbon Workflows (Phase 1: actions) — implementation plan

**Spec:** .ai/specs/2026-08-22-activepieces-pieces-integration.md
**Research:** .ai/research/activepieces-pieces-integration.md
**Branch:** guangzhou

Phase 1 scope only: piece **actions** in the builder, connections
(SECRET_TEXT / BASIC_AUTH / CUSTOM_AUTH + env-gated OAuth2), dynamic dropdowns,
child-process execution, run-history parity. NO triggers, NO batching over
integration nodes, NO waitpoints, NO FILE/ARRAY/DYNAMIC/CUSTOM prop types.

Background an executor must know (all verified this session; details in spec):
- Published `@activepieces/piece-*` npm packages are **self-contained CJS
  bundles** (`dist` = one `src/index.js`, `dependencies: {}`, framework inlined,
  i18n JSONs included). Load = `require()` the package, find the export whose
  `constructor.name === 'Piece'`. `piece.actions()` returns
  `Record<string, {name, displayName, description, requireAuth, props, run}>`;
  each prop has `{type, displayName, description?, required, defaultValue?}`,
  dropdowns add `{options: fn, refreshers: string[]}`, static dropdowns embed
  `{options: {options: [{label, value}]}}`. `piece.auth` is one auth property
  OR an array of them; OAuth2 auth carries `authUrl`, `tokenUrl`, `scope`.
- Pieces' bundled HTTP client sets `NODE_TLS_REJECT_UNAUTHORIZED='0'` per
  request — piece code must ONLY ever run in a spawned child process with a
  scrubbed env, never in-process.
- The `.context/activepieces` clone exists for reference reading (gitignored).
  Never import from it; never copy files from it verbatim without the MIT
  attribution header described in Task 2.

## Progress
- [ ] Task 1: Scaffold `@carbon/pieces` package
- [ ] Task 2: Piece manifest + catalog generator + generated catalog
- [ ] Task 3: Migration — `pieceConnection`, `pieceStore`, vault RPCs
- [ ] Task 4: Regenerate DB types
- [ ] Task 5: `@carbon/workflows` — `json` value kind
- [ ] Task 6: `@carbon/workflows` — piece catalog contract + `integration` node kind
- [ ] Task 7: `@carbon/workflows` — `integration` executor + `WorkflowServices.runPiece`
- [ ] Task 8: Harness — child-process piece runner in `@carbon/pieces`
- [ ] Task 9: `@carbon/jobs` — `runPiece` implementation + services wiring
- [ ] Task 10: `@carbon/jobs` — OAuth2 token refresh for piece connections
- [ ] Task 11: ERP — connection models + service functions
- [ ] Task 12: ERP — Connections UI (list + drawer forms)
- [ ] Task 13: ERP — generic piece OAuth install + callback routes
- [ ] Task 14: ERP — piece catalog in the builder (palette, node card, meta)
- [ ] Task 15: ERP — IntegrationForm (node config)
- [ ] Task 16: ERP — dynamic options route + `DynamicOptionsField`
- [ ] Task 17: Inject the piece catalog at every catalog construction site
- [ ] Task 18: Run history naming for integration steps
- [ ] Task 19: i18n extract + full validation sweep
- [ ] Task 20: Browser verification via /test

## Dependencies
- Task 2 needs Task 1. Task 4 needs Task 3. Tasks 5→6→7 are sequential.
- Task 8 needs Task 1 (not Task 2). Task 9 needs Tasks 3, 7, 8. Task 10 needs Task 3.
- Task 11 needs Task 4. Task 12 needs Task 11. Task 13 needs Tasks 10, 11.
- Tasks 14–16 need Tasks 2 and 6. Task 17 needs Tasks 2, 6.
- Independent groups that may run in parallel: {1,2} ∥ {3,4} ∥ {5}; then {6,7} ∥ {8} ∥ {11}; then {9,10} ∥ {12,13} ∥ {14,15,16}.
- Tasks 18–20 last, in order.

---

## Task 1: Scaffold `@carbon/pieces` package

**Depends on:** none
**Files:**
- Create: `packages/pieces/package.json`
- Create: `packages/pieces/tsconfig.json`
- Create: `packages/pieces/src/index.ts`
- Create: `packages/pieces/src/types.ts`
- Create: `packages/pieces/src/harness/index.ts` (empty export stub for now)
- Create: `packages/pieces/NOTICE`
- Copy from (precedent): `packages/workflows/package.json` + `packages/workflows/tsconfig.json`

**Steps:**
1. Read `packages/workflows/package.json` and mirror its structure (source
   package consumed by other workspaces; keep the same `main`/`exports`/build
   arrangement it uses). Name: `@carbon/pieces`, version `0.0.0`,
   license `MIT`.
2. Exports map must expose two entry points: `"."` → `src/index.ts`
   (browser-safe: types + generated catalog re-export only) and `"./harness"` →
   `src/harness/index.ts` (Node-only; never imported by app client code).
3. `src/types.ts`: define and export the metadata types the generator emits
   (these mirror what Task 6 declares in `@carbon/workflows` — import them
   type-only from `@carbon/workflows` once Task 6 lands; until then declare
   locally and reconcile in Task 6):
   ```typescript
   export type PiecePropType =
     | "SHORT_TEXT" | "LONG_TEXT" | "NUMBER" | "CHECKBOX" | "DATE_TIME"
     | "STATIC_DROPDOWN" | "STATIC_MULTI_SELECT_DROPDOWN"
     | "DROPDOWN" | "MULTI_SELECT_DROPDOWN" | "JSON" | "OBJECT" | "MARKDOWN";
   export type PiecePropMeta = {
     type: PiecePropType; displayName: string; description?: string;
     required: boolean; defaultValue?: unknown; advanced?: boolean;
     options?: { label: string; value: string }[];   // static dropdowns only
     dynamic?: boolean; refreshers?: string[];        // dynamic dropdowns only
   };
   export type PieceAuthMeta =
     | { type: "SECRET_TEXT"; displayName: string; description?: string }
     | { type: "BASIC_AUTH"; displayName: string; username: string; password: string }
     | { type: "CUSTOM_AUTH"; displayName: string; props: Record<string, PiecePropMeta> }
     | { type: "OAUTH2"; displayName: string; authUrl: string; tokenUrl: string;
         scope: string[]; pkce?: boolean };
   export type PieceActionMeta = {
     name: string; displayName: string; description: string;
     requireAuth: boolean; props: Record<string, PiecePropMeta>;
   };
   export type PieceMeta = {
     name: string;            // "@activepieces/piece-slack"
     key: string;             // "slack" (name without the scope prefix)
     version: string; displayName: string; description?: string;
     logoPath: string;        // "/pieces/slack.png" (mirrored, Task 2)
     categories: string[]; contextVersion: string;   // "V0" | "V1" etc.
     auth: PieceAuthMeta[];   // empty array = no auth required
     actions: Record<string, PieceActionMeta>;
   };
   export type PieceCatalog = Record<string, PieceMeta>;   // keyed by `key`
   ```
4. `NOTICE`: state that piece packages and metadata derive from Activepieces
   (github.com/activepieces/activepieces), MIT License, Copyright 2020-2024
   Activepieces Inc., and reproduce the MIT license text. (The published npm
   artifacts carry no license field; the repo-level MIT is the grant.)
5. Add the package to the workspace: confirm `pnpm-workspace.yaml` already
   globs `packages/*` (it does — no edit needed unless verification fails).

**Verify:**
```bash
pnpm install && pnpm exec turbo run typecheck --filter=@carbon/pieces
# Expected: typecheck passes (empty package, zero errors)
```

**Out of scope:** any piece dependency, the generator, the harness body.

---

## Task 2: Piece manifest + catalog generator + generated catalog

**Depends on:** Task 1
**Files:**
- Create: `packages/pieces/manifest.json`
- Create: `packages/pieces/scripts/generate.ts`
- Create: `packages/pieces/scripts/extract-child.ts`
- Create: `packages/pieces/src/catalog.generated.ts` (generator output)
- Create: `apps/erp/public/pieces/*.png` (generator output, mirrored logos)
- Modify: `packages/pieces/package.json` — add piece deps + scripts
- Modify: root `package.json` — add `generate:piece-catalog` + `check:piece-catalog` scripts
- Copy from (precedent): `scripts/generate-workflow-catalog.ts` + `scripts/check-workflow-catalog.ts` (generate/check pairing and drift-diff style)

**Steps:**
1. Pin starter pieces. For each of `slack`, `openai`, `sendgrid`,
   `telegram-bot`, `airtable`, `hubspot`: run
   `pnpm view @activepieces/piece-<key> version` and add
   `"@activepieces/piece-<key>": "<exact version>"` (no `^`) to
   `packages/pieces/package.json` `dependencies`. Write
   `manifest.json` as `{ "pieces": [{ "name": "@activepieces/piece-slack", "key": "slack", "version": "<pinned>" }, ...] }`.
2. `scripts/extract-child.ts` — a standalone script executed via
   `child_process.fork` per piece (isolation: piece bundles run hostile
   module-level code paths; never `require` one in the generator's own
   process). It receives the package name via argv, does
   `const mod = require(pkgName)`, finds
   `Object.values(mod).find(e => e?.constructor?.name === 'Piece')`, and
   prints one JSON blob to stdout: displayName, description, logoUrl,
   categories, auth (normalize: absent → `[]`, single → `[x]`, array → as-is;
   map each auth property's `type` field — the runtime `PropertyType` strings
   are `"SECRET_TEXT"`, `"BASIC_AUTH"`, `"CUSTOM_AUTH"`, `"OAUTH2"`),
   `contextVersion` (from `piece.getContextInfo?.().version ?? "V0"` — if that
   accessor doesn't exist on the loaded object, record `"V0"` and continue),
   and every action via `piece.actions()`: name/displayName/description/
   `requireAuth !== false`, and each prop's type/displayName/description/
   required/defaultValue, plus for `STATIC_DROPDOWN`/`STATIC_MULTI_SELECT_DROPDOWN`
   the embedded `options.options` label/value list, and for
   `DROPDOWN`/`MULTI_SELECT_DROPDOWN` `dynamic: true` + `refreshers`.
3. `scripts/generate.ts` — for each manifest entry: fork the extractor, parse
   its stdout, then **filter**: drop any ACTION containing a prop whose type is
   not in the `PiecePropType` union of Task 1 (FILE, ARRAY, OBJECT-with-subprops,
   DYNAMIC, CUSTOM, RICH_TEXT, DATE_RANGE, COLOR, OIDC → out; keep MARKDOWN,
   it renders as help text and is never a value). Drop any PIECE whose every
   action was dropped, and log `piece <key>: kept M/N actions` for each.
   Download `logoUrl` to `apps/erp/public/pieces/<key>.png` (skip download if
   the file exists and `--force` not passed); set `logoPath`. Emit
   `src/catalog.generated.ts`:
   `// GENERATED by scripts/generate.ts — do not edit.` + `export const PIECE_CATALOG = {...} as const satisfies PieceCatalog;`
4. Wire scripts: in `packages/pieces/package.json` add
   `"generate": "tsx scripts/generate.ts"`, `"check": "tsx scripts/generate.ts --check"`
   (`--check` regenerates to a temp string and diffs against the committed
   file, exit 1 with the first differing piece key on drift — mirror the
   data-compare approach of `scripts/check-workflow-catalog.ts`). In root
   `package.json` add
   `"generate:piece-catalog": "pnpm --filter @carbon/pieces generate"`
   and `"check:piece-catalog": "pnpm --filter @carbon/pieces check"`.
5. Run the generator. In `src/index.ts` export `PIECE_CATALOG` and the types.
6. If a starter piece's auth normalizes to something outside the four supported
   auth types, or its extraction fails structurally: REMOVE that piece from the
   manifest, note it in the task log, and continue — but the final manifest
   must keep ≥1 OAuth2 piece (slack) and ≥3 SECRET_TEXT-class pieces. If slack
   itself fails extraction, STOP and report — do not improvise.

**Verify:**
```bash
pnpm run generate:piece-catalog && pnpm run check:piece-catalog
# Expected: exit 0; catalog.generated.ts committed; log lines "piece slack: kept M/N actions" with M >= 30
node -e "const {PIECE_CATALOG}=require('./packages/pieces/src/catalog.generated.ts')" 2>/dev/null || pnpm exec turbo run typecheck --filter=@carbon/pieces
# Expected: typecheck passes
ls apps/erp/public/pieces/slack.png
# Expected: file exists
```

**Out of scope:** executing any piece `run()`/`options()`; CI workflow wiring
(follow-up); i18n of piece strings.

---

## Task 3: Migration — `pieceConnection`, `pieceStore`, vault RPCs

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_piece-connections.sql` (via `pnpm db:migrate:new piece-connections` — never hand-pick the timestamp, never `000000` HHMMSS)
- Copy from (precedent): `packages/database/supabase/migrations/20260817122916_integration-secret-vault.sql` (vault RPC pattern — READ IT FIRST and mirror it exactly), `20260810100100_workflows-foundation.sql` (RLS policy text)

**Steps:**
1. `pnpm db:migrate:new piece-connections`.
2. Write the SQL. Tables (idempotent guards on everything):

```sql
CREATE TABLE IF NOT EXISTS "pieceConnection" (
    "id" TEXT NOT NULL DEFAULT id('pcon'),
    "companyId" TEXT NOT NULL,
    "pieceName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "authType" TEXT NOT NULL CHECK ("authType" IN ('SECRET_TEXT','BASIC_AUTH','CUSTOM_AUTH','OAUTH2')),
    "config" JSONB NOT NULL DEFAULT '{}',
    "secretRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active' CHECK ("status" IN ('Active','Error')),
    "statusReason" TEXT,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "pieceConnection_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "pieceConnection_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "pieceConnection_name_unique" UNIQUE ("companyId", "pieceName", "name")
);
CREATE INDEX IF NOT EXISTS "pieceConnection_companyId_idx" ON "pieceConnection" ("companyId");
CREATE INDEX IF NOT EXISTS "pieceConnection_createdBy_idx" ON "pieceConnection" ("createdBy");
CREATE INDEX IF NOT EXISTS "pieceConnection_updatedBy_idx" ON "pieceConnection" ("updatedBy");

CREATE TABLE IF NOT EXISTS "pieceStore" (
    "id" TEXT NOT NULL DEFAULT id('pkv'),
    "companyId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "pieceStore_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "pieceStore_key_unique" UNIQUE ("companyId", "scope", "key"),
    CONSTRAINT "pieceStore_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "pieceStore_companyId_idx" ON "pieceStore" ("companyId");
```

3. RLS — exactly four policies per table, the standardized names, the
   `workflows` permission module (matches `20260810100100`'s workflow tables):

```sql
ALTER TABLE "pieceConnection" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."pieceConnection" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('workflows_view'))::text[])
);
CREATE POLICY "INSERT" ON "public"."pieceConnection" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('workflows_update'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."pieceConnection" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('workflows_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."pieceConnection" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('workflows_update'))::text[])
);
-- Same four for "pieceStore", same permissions.
```

4. Vault RPCs: open `20260817122916_integration-secret-vault.sql`, copy its
   three functions and rename/rekey them:
   `upsert_piece_connection_secret(p_company_id TEXT, p_connection_id TEXT, p_secret JSONB)`,
   `get_piece_connection_secret(p_company_id TEXT, p_connection_id TEXT) RETURNS JSONB`,
   `delete_piece_connection_secret(p_company_id TEXT, p_connection_id TEXT)`.
   Vault secret name: `piece:<companyId>:<connectionId>`. The upsert stamps
   `pieceConnection.secretRef`. Keep VERBATIM from the precedent: `SECURITY
   DEFINER`, `SET search_path`, `REVOKE ALL ... FROM PUBLIC, anon, authenticated`,
   `GRANT EXECUTE ... TO service_role`, and the `AFTER DELETE` trigger
   (`trg_drop_piece_connection_secret` on `pieceConnection`) dropping the vault
   row. Guard all function/trigger creation with `DROP ... IF EXISTS` first
   (migrations must be idempotent — the deploy runner retries failed files over
   committed partial state).
5. Apply: `pnpm db:migrate` (applies + regenerates types + swagger). Never
   rebuild the database. If `crbn migrate` fails on local permissions, STOP and
   report (do not hand-apply with psql).

**Verify:**
```bash
pnpm db:migrate
# Expected: migration applies cleanly, types regenerate
psql "$SUPABASE_DB_URL" -c '\d "pieceConnection"' 2>/dev/null || echo "verify via generated types in Task 4"
# Expected: table exists with composite PK ("id","companyId")
```

**Out of scope:** any `integration` catalog-table row (`pieceConnection` is
deliberately NOT a `companyIntegration`); seed data.

---

## Task 4: Regenerate DB types

**Depends on:** Task 3
**Files:**
- Modify: generated `@carbon/database` types (via script only — never hand-edit)

**Steps:**
1. `pnpm run generate:types` (idempotent even though `db:migrate` already ran it — root AGENTS.md requires it after schema changes, before typechecking).

**Verify:**
```bash
grep -l "pieceConnection" packages/database/src/types.ts packages/database/src/*.ts 2>/dev/null | head -1
# Expected: at least one generated file names pieceConnection
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: passes
```

**Out of scope:** everything else.

---

## Task 5: `@carbon/workflows` — `json` value kind

**Depends on:** none
**Files:**
- Modify: `packages/workflows/src/definition/types.ts` — add `{ kind: "json" }` to `ValueType`
- Modify: `packages/workflows/src/runtime/types.ts` — add the `json` `RuntimeValue` member
- Modify: `packages/workflows/src/runtime/values.ts` — `jsonValue(data)` constructor
- Modify: `packages/workflows/src/runtime/resolve.ts` — path walking under a json value
- Modify: `packages/workflows/src/runtime/compare.ts` — comparing json-derived leaves
- Modify: `packages/workflows/src/definition/validate.ts` — accept any path beneath a json-typed output
- Create: `packages/workflows/src/runtime/json.test.ts`

**Steps:**
1. Read `packages/workflows/AGENTS.md` §"Never" first: flat zod unions, ES2019,
   no Node builtins, no new runtime deps.
2. `ValueType` gains `{ kind: "json" }` (flat union member). `RuntimeValue`
   gains `{ kind: "json"; data: unknown }`. `values.ts` exports
   `jsonValue(data: unknown)`.
3. `resolve.ts`: when a reference's path continues past a `json` value, walk
   the remaining segments over `data`: an object key or a numeric index into an
   array. Each resolved leaf coerces by JS type: `string|number|boolean` →
   the matching primitive `RuntimeValue`; array/object → `jsonValue` again;
   `null`/`undefined`/absent key → the existing unresolved-with-reason outcome
   (reuse the exact message pattern resolve.ts uses for a missing property —
   read the file and match it; missing data must SKIP, never throw).
4. `validate.ts` / the type layer: a declared output of kind `json` accepts ANY
   property path in a reference (layer 5 cannot check it); the referenced
   value's static type for layer-6 purposes is "unknown scalar" — permitted
   wherever a string/number/boolean is accepted, and as a template part.
   `rendersAsText` accepts a bare `json` value (renders as compact
   `JSON.stringify`, capped at 512 chars with the standard `… N more characters`
   marker style). A `json` value is NOT a list: it never feeds `loopList`,
   never batches.
5. `compare.ts`: a json-derived leaf compares by its coerced primitive type
   (already handled by step 3's coercion — verify no `compare.ts` change is
   actually needed; if the switch exhaustively rejects unknown kinds, add the
   `json` case as "never ordered, `eq`/`neq` by deep-equal JSON.stringify").
6. Tests (`json.test.ts`, use `createFixtureCatalog` + `fixtures.ts` per the
   existing runtime tests as precedent — read `packages/workflows/src/runtime/resolve.test.ts`
   style first): resolving `result.a.b` through nested data; numeric index;
   missing path skips with reason; template rendering of a leaf and of a whole
   json value; `eq` on a string leaf.

**Verify:**
```bash
pnpm --filter @carbon/workflows test
# Expected: all tests pass including json.test.ts
pnpm --filter @carbon/workflows exec tsgo --noEmit
# Expected: no errors
```

**Out of scope:** any node kind; `pairs`; the catalog.

---

## Task 6: `@carbon/workflows` — piece catalog contract + `integration` node kind

**Depends on:** Task 5
**Files:**
- Create: `packages/workflows/src/catalog/pieces.ts` — the `PieceCatalog` TYPE contract (no data)
- Modify: `packages/workflows/src/definition/catalog.ts` — `WorkflowCatalog` gains `getPiece` / `getPieceAction`; `createFixtureCatalog` gains a `pieces` option
- Modify: `packages/workflows/src/catalog/catalog.ts` — `createWorkflowCatalog(overlay?, pieces?)`
- Modify: `packages/workflows/src/definition/schema.ts` — `integration` node schema variant
- Modify: `packages/workflows/src/definition/nodes.ts` — `NODE_KINDS.integration`
- Create: `packages/workflows/src/definition/integration.test.ts`
- Modify: `packages/pieces/src/types.ts` — re-export the contract types from `@carbon/workflows` instead of local declarations (reconciliation promised in Task 1)

**Steps:**
1. Move the `PieceMeta`/`PieceActionMeta`/`PiecePropMeta`/`PieceAuthMeta`/
   `PieceCatalog` TYPE declarations (Task 1 step 3) into
   `packages/workflows/src/catalog/pieces.ts` (types only — the DATA stays in
   `@carbon/pieces`; `@carbon/workflows` gains no dependency).
   `@carbon/pieces` imports them type-only from `@carbon/workflows`
   and re-exports for its own consumers (add `@carbon/workflows` to its
   devDependencies for types).
2. `WorkflowCatalog` (definition/catalog.ts) gains:
   `getPiece(key: string): PieceMeta | undefined` and
   `getPieceAction(key: string, action: string): PieceActionMeta | undefined`.
   `createWorkflowCatalog(overlay?, pieces?: PieceCatalog)` implements them
   over the injected data (undefined map → both return undefined — a build
   with no pieces still validates non-integration workflows).
   `createFixtureCatalog({ pieces })` mirrors it for tests. The catalog is
   INJECTED, never imported — same rule as the custom-fields overlay.
3. `schema.ts`: add the node data schema, draft-tolerant like every kind
   (see the workflows-module AGENTS.md rule: a draft saves half-filled):
   ```typescript
   const integrationNodeDataSchema = z.object({
     name: z.string(),
     expanded: z.boolean().optional(),
     piece: z.object({ name: z.string(), version: z.string() }),
     action: z.string(),          // "" while unconfigured
     connectionId: z.string(),    // "" while unconfigured
     inputs: z.record(valueOrRefSchema),
   });
   ```
   Add `"integration"` wherever node types are enumerated in this file (flat
   union). Do NOT bump `CURRENT_DEFINITION_FORMAT_VERSION` and do NOT touch
   `migrateDefinition` — a new variant is additive; existing documents parse.
4. `nodes.ts`: add the `NODE_KINDS.integration` entry (the mapped type forces
   all seven members — read two existing entries, `action` and `compute`, as
   the precedent before writing):
   - handles: same success/failure pair as `action`.
   - `outputs(node, ctx)`: `undefined` until `piece.name && action` are
     nonempty AND `ctx.catalog.getPieceAction(...)` resolves; then
     `{ result: { kind: "json" } }`.
   - `loopList`: `undefined` (v1: integration nodes never batch).
   - `configured(node, catalog)`: piece key + action nonempty and present in
     the catalog (mirrors how an unknown action suppresses consequent errors).
   - `checks(node, ctx)`: report (a) `UNKNOWN_ACTION`-class issue when the
     piece or action is not in the injected catalog (reuse the closest
     existing `WorkflowIssueCode` — read `issues.ts` and pick; add a new code
     ONLY if none fits, wiring its message like its siblings); (b)
     `MISSING_INPUT` for every required prop (skip `MARKDOWN` props) with no
     supplied value; (c) `INCOMPLETE_CONFIG` when `connectionId` is empty or
     the piece requires auth (`auth.length > 0` and any kept action has
     `requireAuth`) and the node has none; (d) `TYPE_MISMATCH` when a literal
     is supplied to a `STATIC_DROPDOWN` outside its `options` values, or a
     non-string literal to a text prop. Expected ValueType per prop for the
     resolver: SHORT_TEXT/LONG_TEXT/JSON/OBJECT/DATE_TIME → `primitive string`
     (templates legal), NUMBER → `primitive number`, CHECKBOX →
     `primitive boolean`, dropdowns → `primitive string`
     (STATIC_MULTI_SELECT → `list<string>`).
5. Tests (`integration.test.ts`, precedent: existing `validate.test.ts`
   fixtures): activatable definition with a configured integration node
   validates empty; missing required prop → `MISSING_INPUT`; unknown action →
   exactly one issue; empty `connectionId` → `INCOMPLETE_CONFIG`; a reference
   to `result.foo.bar` from a downstream condition validates (json rule);
   catalog without pieces → the piece node reports unknown, nothing crashes.

**Verify:**
```bash
pnpm --filter @carbon/workflows test && pnpm --filter @carbon/workflows exec tsgo --noEmit
# Expected: pass; integration.test.ts green
pnpm run check:workflow-catalog
# Expected: still green (generated action catalog untouched)
```

**Out of scope:** the runtime executor (Task 7); labels.generated.ts (piece
names are runtime data, not Lingui catalog entries).

---

## Task 7: `@carbon/workflows` — `integration` executor + `WorkflowServices.runPiece`

**Depends on:** Task 6
**Files:**
- Modify: `packages/workflows/src/runtime/types.ts` — `runPiece` on `WorkflowServices`
- Create: `packages/workflows/src/runtime/integration.ts`
- Modify: `packages/workflows/src/runtime/executors.ts` — `EXECUTORS.integration`
- Modify: `packages/workflows/src/runtime/fixtures.ts` — fixture `runPiece`
- Create: `packages/workflows/src/runtime/integration.test.ts`
- Copy from (precedent): `packages/workflows/src/runtime/action.ts` (input resolution + `ctx.record` + outcome mapping — but NO batch logic)

**Steps:**
1. `WorkflowServices` gains (required member — every implementation breaks
   until Task 9 lands; that compile error is the design):
   ```typescript
   runPiece(params: {
     pieceName: string; pieceVersion: string; actionName: string;
     connectionId: string; inputs: Record<string, RuntimeValue>;
   }): Promise<ActionOutcome>;
   ```
   Update `fixtures.ts`'s fake services with a stub returning
   `{ ok: true, outputs: { result: jsonValue({}) } }` so existing tests compile.
2. `integration.ts` — `integrationExecutor`, shaped like `actionExecutor`
   minus batching: resolve every supplied input through the ONE resolver
   (templates legal only on string-expected props per Task 6's mapping; no
   `linkify`), report resolved values via `ctx.record?.()`, refuse with a
   readable failure when a required prop resolves to nothing
   (`"This step is missing <prop displayName>."`), then
   `await ctx.services.runPiece(...)`. `ok: true` →
   `{ status: "Succeeded", outputs, handle: SUCCESS }`; `ok: false` →
   `{ status: "Failed", error, handle: FAILURE_HANDLE }` (read `action.ts`
   for the exact handle constants and NodeResult shape and match them).
3. `executors.ts`: `integration: { permission: () => ({ module: "workflows", action: "update" }), ... }`
   — read the existing entries' exact `NodeExecutor` shape first; permission
   and execute must come from this single entry.
4. Tests: executor resolves a template input from an upstream value; missing
   required prop fails without calling `runPiece`; a `runPiece` failure maps to
   the failure handle; outputs carry `result` as a json value.

**Verify:**
```bash
pnpm --filter @carbon/workflows test && pnpm --filter @carbon/workflows exec tsgo --noEmit
# Expected: pass. NOTE: @carbon/jobs typecheck now FAILS (missing runPiece) — expected until Task 9; do not "fix" it here.
```

**Out of scope:** the jobs implementation; any I/O.

---

## Task 8: Harness — child-process piece runner

**Depends on:** Task 1 (piece deps arrive with Task 2 but the harness must not import them statically)
**Files:**
- Create: `packages/pieces/src/harness/index.ts` — `runPieceCall(params)`
- Create: `packages/pieces/src/harness/child.ts` — the forked entry
- Create: `packages/pieces/src/harness/coerce.ts` — prop coercion
- Create: `packages/pieces/src/harness/protocol.ts` — IPC message types
- Create: `packages/pieces/src/harness/harness.test.ts`
- Create: `packages/pieces/src/harness/fixtures/echo-piece.cjs` — test fixture

**Steps:**
1. `protocol.ts`: discriminated unions for parent→child
   `{ kind: "run", pieceName, actionName, props, auth, step, runId } |
    { kind: "options", pieceName, actionName, propertyName, props, auth } |
    { kind: "svc-result", id, ok, value?, error? }`
   and child→parent
   `{ kind: "result", ok, output?, error? } |
    { kind: "svc", id, method: "store.get"|"store.put"|"store.delete"|"files.write", args }`.
2. `child.ts` (compiled/executed via fork with tsx or as plain CJS — match how
   Task 2's `extract-child.ts` ended up being forked and reuse that mechanism):
   on the `run` message, `require(pieceName)`, extract the `Piece` export, get
   the action from `piece.actions()[actionName]` (refuse with a readable error
   when absent), coerce props (`coerce.ts`), build the context:
   `{ auth, propsValue, store, files, connections: { get: async () => null },
      step: { name: step }, project: { id: "carbon", externalId: async () => undefined },
      flows: { current: { id: runId, version: { id: runId } }, list: async () => { throw new Error("not supported") } },
      tags: { add: async () => {} }, output: { update: async () => {} },
      server: { token: "", apiUrl: "", publicUrl: "" },
      executionType: "BEGIN",
      run: { id: runId, stop: (r) => { halted = r ?? true }, respond: () => {},
             createWaitpoint: () => { throw new Error("Approvals and waitpoints are not supported yet.") },
             waitForWaitpoint: () => { throw new Error("Approvals and waitpoints are not supported yet.") } } }`
   where `store.*`/`files.write` proxy over IPC (`svc` request, await matching
   `svc-result`). Await `action.run(ctx)`, post `{ kind: "result", ok: true, output }`.
   Any throw → `{ ok: false, error: String(err?.message ?? err) }`. On the
   `options` message: get `action.props[propertyName]`, call
   `prop.options({ ...props, auth }, { searchValue: undefined, server: { apiUrl: "", publicUrl: "", token: "" } })`
   and return its `DropdownState`.
3. `coerce.ts` (semantics per Activepieces' props processor, reimplemented
   minimally — add a header comment attributing the semantics to
   activepieces MIT, per NOTICE): for each declared prop present in `props`:
   NUMBER → `Number(x)`, reject NaN; CHECKBOX → boolean or `"true"/"false"`;
   JSON/OBJECT → `JSON.parse` when string (reject unparseable), passthrough
   when object; everything else passes through as-is. Required check: reject
   `undefined | null | ""` for `required` props (MARKDOWN excluded). Return
   `{ ok: false, error: "<displayName> is required." | "<displayName> must be a number." }`
   style errors.
4. `index.ts` — `runPieceCall({ message, adapters, timeoutMs = 30_000 })`:
   `fork(childPath, [], { env: { PATH: process.env.PATH ?? "" }, serialization: "advanced", stdio: ["ignore","pipe","pipe","ipc"] })`
   — the env allowlist is THE security boundary: nothing else from
   `process.env` crosses. Send the message; answer `svc` requests via
   `adapters` (`{ store: {get,put,delete}, files: {write} }`); resolve on
   `result`; kill the child (`SIGKILL`) on settle AND on timeout
   (timeout → `{ ok: false, error: "The step timed out after 30 seconds." }`).
   Capture child stderr, truncate to 2 KB, include in error results.
5. Fixture `echo-piece.cjs`: a hand-built module exporting a `Piece`-shaped
   object (`class Piece {...}` instance with `actions()` returning an `echo`
   action whose `run` returns `{ echoed: ctx.propsValue, authSeen: !!ctx.auth }`,
   plus a `sleepy` action that never resolves, plus a `storey` action that
   round-trips `ctx.store.put/get`). The harness test must load it by PATH:
   give `runPieceCall` an optional `resolveFrom` override so tests can point
   `require` at the fixture instead of an installed package.
6. Tests: echo returns coerced output; required-prop refusal; timeout kills
   and reports (use `timeoutMs: 500` against `sleepy`; assert the child PID is
   dead); store round-trip reaches the in-memory test adapter; env scrubbing
   (fixture action returns `process.env` keys; assert only PATH).

**Verify:**
```bash
pnpm --filter @carbon/pieces test
# Expected: harness.test.ts green, including the timeout-kill and env-scrub assertions
pnpm exec turbo run typecheck --filter=@carbon/pieces
# Expected: passes
```

**Out of scope:** OAuth refresh, DB adapters (Task 9), real piece network calls.

---

## Task 9: `@carbon/jobs` — `runPiece` implementation + services wiring

**Depends on:** Tasks 3, 7, 8
**Files:**
- Create: `packages/jobs/src/workflows/actions/piece.ts`
- Create: `packages/jobs/src/workflows/actions/piece.test.ts`
- Modify: `packages/jobs/src/workflows/actions/services.ts` — add `runPiece` to the returned services
- Modify: `packages/jobs/src/workflows/engine/execute.ts` — pass `PIECE_CATALOG` into `createWorkflowCatalog` (see Task 17 for the full call-site sweep; this task does the engine site)
- Modify: `packages/jobs/package.json` — dependency on `@carbon/pieces`
- Modify: `packages/jobs/src/workflows/retention.ts` — export `compactForLog` if not already exported
- Copy from (precedent): `packages/jobs/src/workflows/actions/webhook.ts` (outcome shape, error-string tone), `packages/ee/src/integrations/secrets.ts` (secret bag merge semantics)

**Steps:**
1. `piece.ts` — `runPieceAction({ client, companyId, ownerId, runId, workflowId, params })`
   where `client` is the OWNER-scoped client (this is the rule from
   `packages/jobs/AGENTS.md`; the ONE deliberate exception below is documented
   inline):
   a. Owner-scoped read:
      `client.from("pieceConnection").select("*").eq("id", params.connectionId).eq("companyId", companyId).maybeSingle()`.
      Null (absent OR RLS-refused — deliberately indistinguishable) →
      `{ ok: false, error: "That connection is no longer available." }`.
   b. **Documented privileged exception** (mirror of the run-log rule; cite
      spec D7 in a comment): `getCarbonServiceRole().rpc("get_piece_connection_secret", { p_company_id: companyId, p_connection_id: params.connectionId })`
      to fetch the secret bag. This happens ONLY after (a) proved the owner
      can see the row. Merge bag + `config` into the auth value by `authType`:
      SECRET_TEXT → `{ type: "SECRET_TEXT", secret_text }` (and, when the
      piece's `contextVersion === "V0"`, unwrap to the bare string);
      BASIC_AUTH → `{ type: "BASIC_AUTH", username, password }`;
      CUSTOM_AUTH → `{ type: "CUSTOM_AUTH", props }` (V0 → bare props);
      OAUTH2 → the stored token object (Task 10's refresh runs first).
   c. OAuth2: call `refreshPieceConnectionIfNeeded` (Task 10) before building
      the auth value.
   d. Call `runPieceCall` from `@carbon/pieces/harness` with adapters:
      `store` → `pieceStore` reads/writes THROUGH THE OWNER CLIENT
      (`scope: "workflow:" + workflowId`, upsert on the unique key, delete);
      `files.write` → service-role storage upload to bucket `private`, path
      `piece-files/${companyId}/${runId}/${crypto-random}-${fileName}`, return
      a 24h signed URL (second documented privileged use, same comment).
   e. Success: cap the output — `compactForLog(output)` from
      `../retention` — and return
      `{ ok: true, outputs: { result: jsonValue(capped) }, summary: "Ran <piece displayName>: <action displayName>." }`.
      Failure: `{ ok: false, error }` with the harness's message passed
      through (it is already customer-readable).
2. `services.ts`: extend `createWorkflowServices` params (it already closes
   over client/companyId/ownerId/runId/workflowId — verify against the file)
   and add `runPiece: (params) => runPieceAction({ ...closure, params })`.
3. `execute.ts`: where the catalog is constructed (the `custom-fields` step),
   change to `createWorkflowCatalog(overlay, PIECE_CATALOG)` with
   `import { PIECE_CATALOG } from "@carbon/pieces";`.
4. Tests (`piece.test.ts`, mock the harness module and the service-role rpc):
   absent connection short-circuits before any rpc; secret bag merged per auth
   type incl. V0 unwrapping; harness failure → `ok: false`; output larger than
   the compact caps comes back compacted; store adapter writes carry
   companyId + workflow scope.

**Verify:**
```bash
pnpm --filter @carbon/jobs test
# Expected: piece.test.ts green; existing workflow action tests still green
pnpm --filter @carbon/jobs typecheck
# Expected: passes (the Task-7 compile break is now resolved)
```

**Out of scope:** OAuth refresh internals (Task 10); catalog sites outside the
engine (Task 17).

---

## Task 10: `@carbon/jobs` — OAuth2 token refresh for piece connections

**Depends on:** Task 3
**Files:**
- Create: `packages/jobs/src/workflows/actions/piece-oauth.ts`
- Create: `packages/jobs/src/workflows/actions/piece-oauth.test.ts`
- Modify: `packages/env/src/index.ts` — `getPieceOAuthClient(pieceKey)` helper
- Copy from (precedent): `packages/jobs/src/workflows/actions/url-guard.ts` (undici usage), `.claude/rules/environment-configuration.md` (env access lives in @carbon/env)

**Steps:**
1. `@carbon/env`: export
   `getPieceOAuthClient(pieceKey: string): { clientId: string; clientSecret: string } | null`
   reading `process.env[`PIECES_OAUTH_${pieceKey.toUpperCase().replace(/-/g, "_")}_CLIENT_ID`]`
   and `_CLIENT_SECRET` (both required for non-null; server-only — return null
   in the browser). Add `PIECES_OAUTH_SLACK_CLIENT_ID/SECRET` to `.env.example`
   with a comment.
2. `piece-oauth.ts` — `refreshPieceConnectionIfNeeded({ companyId, connectionId, pieceKey, tokenValue, persist })`:
   - No-op unless `tokenValue.expires_in` is set and
     `Date.now()/1000 + 900 >= tokenValue.claimed_at + tokenValue.expires_in`
     (the 15-minute early-refresh rule; `claimed_at` is epoch SECONDS —
     Activepieces' semantics).
   - Lock: `SET piece-oauth:<connectionId> <nonce> NX PX 30000` via the
     `@carbon/kv` redis client (read `packages/kv/src/` for the exported
     client accessor first; if no raw-client accessor exists, STOP and report
     rather than adding one silently). On lock miss: wait 2s, re-read the
     connection (another worker may have refreshed), and proceed with whatever
     is stored.
   - Refresh: `POST tokenValue.token_url`,
     `application/x-www-form-urlencoded`, body
     `grant_type=refresh_token&refresh_token=...&client_id=...&client_secret=...`
     (credentials from `getPieceOAuthClient`; absent credentials → return
     `{ ok: false, error: "No OAuth app is configured for <pieceKey>." }`).
     Non-2xx → mark the connection `status: 'Error'` with the response's
     `error_description ?? error ?? status` via `persist` and return failure.
   - Success: merge `{ access_token, refresh_token: json.refresh_token ?? old, expires_in, claimed_at: nowSeconds }`,
     call `persist(newValue)` (Task 9 supplies a persist that writes through
     `upsert_piece_connection_secret` service-role RPC), release the lock
     (DEL only if nonce matches), return the fresh value.
3. Tests: not-yet-expiring token skips the network; expired token refreshes
   and persists; refresh failure flips status Error; lock miss path re-reads.
   Mock fetch and redis.

**Verify:**
```bash
pnpm --filter @carbon/jobs test
# Expected: piece-oauth.test.ts green
pnpm exec turbo run typecheck --filter=@carbon/env --filter=@carbon/jobs
# Expected: passes
```

**Out of scope:** the authorize-URL flow (Task 13); CLOUD/PLATFORM OAuth
variants (never — spec D6).

---

## Task 11: ERP — connection models + service functions

**Depends on:** Task 4
**Files:**
- Modify: `apps/erp/app/modules/workflows/workflows.models.ts` — `pieceConnectionValidator`
- Modify: `apps/erp/app/modules/workflows/workflows.service.ts` — CRUD reads/writes (non-secret)
- Modify: `apps/erp/app/modules/workflows/workflows.server.ts` — secret persist/resolve (server-only)
- Modify: `apps/erp/app/modules/workflows/index.ts` — barrel (models/service only; NOT workflows.server)
- Copy from (precedent): existing functions in `workflows.service.ts` (`getWorkflows`, `insertWorkflow` — client-first args, `{data, error}` returns), `packages/ee/src/integrations/secrets.ts` (empty-secret = "unchanged, don't overwrite" rule)

**Steps:**
1. `workflows.models.ts`:
   ```typescript
   export const pieceConnectionValidator = z.object({
     id: zfd.text(z.string().optional()),
     pieceName: z.string().min(1),
     name: z.string().min(1, { message: "Name is required" }),
     authType: z.enum(["SECRET_TEXT", "BASIC_AUTH", "CUSTOM_AUTH", "OAUTH2"]),
     // secret fields arrive as secret.<dotPath> form fields, collected in the action
   });
   ```
2. `workflows.service.ts` (all take `client` first, return the supabase
   result envelope like their siblings): `getPieceConnections(client, companyId)`,
   `getPieceConnectionsForPiece(client, companyId, pieceName)`,
   `getPieceConnection(client, id, companyId)`,
   `deletePieceConnection(client, id, companyId)` (row delete; the DB trigger
   drops the vault secret), and `upsertPieceConnectionRow` writing ONLY
   non-secret columns (`pieceName`, `name`, `authType`, `config`, audit
   fields; every key explicitly present — PostgREST nulls absent-but-present
   keys, per the module AGENTS.md).
3. `workflows.server.ts`: `persistPieceConnectionSecrets(serviceClient, companyId, connectionId, secretBag)`
   → `upsert_piece_connection_secret` RPC; skip keys whose value is empty
   string/undefined (the "unchanged" anti-overwrite rule from the integration
   secrets precedent). `resolvePieceConnectionSecrets(serviceClient, companyId, connectionId)`
   → `get_piece_connection_secret`, FAIL CLOSED (throw a named error) when the
   row has a `secretRef` but the RPC errors.
4. Which fields are secret per auth type (single map, exported from
   `workflows.server.ts`): SECRET_TEXT → `["secret_text"]`; BASIC_AUTH →
   `["password"]` (username is config); OAUTH2 → the whole token object
   (stored entirely in the vault; `config` holds only scope/display info);
   CUSTOM_AUTH → every prop whose piece metadata type is `SECRET_TEXT`, rest
   is config.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: passes
pnpm exec biome check apps/erp/app/modules/workflows
# Expected: no errors
```

**Out of scope:** routes, UI, OAuth.

---

## Task 12: ERP — Connections UI (list + drawer forms)

**Depends on:** Task 11
**Files:**
- Create: `apps/erp/app/routes/x+/workflows+/connections.tsx` — list route
- Create: `apps/erp/app/routes/x+/workflows+/connections.new.tsx` — create drawer
- Create: `apps/erp/app/routes/x+/workflows+/connections.$id.tsx` — edit drawer
- Create: `apps/erp/app/routes/x+/workflows+/connections.delete.$id.tsx`
- Create: `apps/erp/app/modules/workflows/ui/Connections/PieceConnectionsTable.tsx`
- Create: `apps/erp/app/modules/workflows/ui/Connections/PieceConnectionForm.tsx`
- Modify: `apps/erp/app/modules/workflows/ui/useWorkflowsSubmodules.tsx` — add "Connections" link
- Modify: `apps/erp/app/utils/path.ts` — `path.to.workflowConnections` etc.
- Copy from (precedent): `apps/erp/app/routes/x+/workflows+/runs.tsx` + `runs.$runId.tsx` (list + Outlet drawer in this exact module), `apps/erp/app/modules/workflows/ui/WorkflowsTable.tsx` (table), `apps/erp/app/modules/workflows/ui/WorkflowForm.tsx` (ValidatedForm-in-drawer)

**Steps:**
1. List loader: `requirePermissions(request, { view: "workflows" })`, load
   `getPieceConnections`; render `PieceConnectionsTable` (columns: piece logo
   `<img src={logoPath}>` + displayName from `PIECE_CATALOG`, name, authType,
   status with `statusReason` tooltip, createdAt via `formatDate` from
   `@carbon/utils` — NEVER `new Date()`), `<Outlet />` for the drawers.
   Detail/create views MUST be Drawer overlays (house rule), not cards.
2. `PieceConnectionForm`: piece picker (Select over `PIECE_CATALOG` entries
   that have ≥1 auth option; pieces whose only auth is OAUTH2 without
   `getPieceOAuthClient` credentials render disabled with reason — expose the
   configured-provider list to the client via the loader, NOT by reading env
   client-side); authType picker when the piece offers multiple; then
   per-auth-type fields: SECRET_TEXT → one `Password` input named
   `secret.secret_text`; BASIC_AUTH → `username` (plain) + `secret.password`;
   CUSTOM_AUTH → iterate the piece's auth `props`, secret-typed ones as
   `secret.<key>`; OAUTH2 → a "Connect" button that opens
   `/api/integrations/pieces/<key>/install` in a popup (Task 13) instead of
   fields. Use `ValidatedForm` + `validator(pieceConnectionValidator)` + form
   components from `~/components/Form`.
3. Create/edit actions: `assertIsPost`, `requirePermissions({ update: "workflows" })`,
   `await requirePlan({ request, client, companyId, feature: "INTEGRATIONS", redirectTo: ... })`
   (precedent: `apps/erp/app/routes/x+/workflows+/new.tsx` line ~26 uses the
   same call with `WORKFLOWS`), validate, `upsertPieceConnectionRow`, collect
   `secret.*` form fields into a bag, `persistPieceConnectionSecrets` with
   `getCarbonServiceRole()`, `throw redirect(path.to.workflowConnections)`
   with a success flash. On service error:
   `return data({}, await flash(request, error(result.error, "...")))`.
4. Delete route: POST-only, confirm modal precedent from the workflows list's
   delete, calls `deletePieceConnection`.
5. Sidebar: add Connections to `useWorkflowsSubmodules` (plain count, never
   parenthesized numbers).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm exec biome check apps/erp/app/routes/x+/workflows+ apps/erp/app/modules/workflows
# Expected: both pass
```

**Out of scope:** OAuth callback internals (Task 13); builder integration.

---

## Task 13: ERP — generic piece OAuth install + callback routes

**Depends on:** Tasks 10, 11
**Files:**
- Create: `apps/erp/app/routes/api+/integrations.pieces.$pieceKey.install.ts`
- Create: `apps/erp/app/routes/api+/integrations.pieces.oauth.ts`
- Modify: `packages/env/src/index.ts` — `PIECES_OAUTH_REDIRECT_URL` (optional; default derived from `getAppUrl()` + the callback path)
- Copy from (precedent): `apps/erp/app/routes/api+/integrations.slack.install.ts` + `integrations.slack.oauth.ts` (state signing, popup + `app_oauth_completed` postMessage, persist-then-redirect shape)

**Steps:**
1. Install route: `requirePermissions({ update: "workflows" })`; read the
   piece's OAUTH2 auth meta from `PIECE_CATALOG[params.pieceKey]` (404 when
   absent); credentials from `getPieceOAuthClient(pieceKey)` (404 with a
   readable error when unconfigured); build
   `authUrl?response_type=code&client_id=...&redirect_uri=<PIECES_OAUTH_REDIRECT_URL>&scope=<scope.join(" ")>&state=<signed>`.
   State: HMAC-signed JSON `{ companyId, userId, pieceKey, connectionName, exp: now+10min }`
   using `SESSION_SECRET` (precedent: the Slack installer's signed state via
   `SLACK_STATE_SECRET`; reuse that helper if it is generic, otherwise a local
   `createHmac` in this server-only route). Return the URL as JSON for the
   popup opener (mirror the Slack `onClientInstall` contract).
2. Callback route: verify state signature + expiry + session
   companyId/userId match (reject mismatches with 403); exchange the code:
   `POST <tokenUrl>` form-encoded
   `grant_type=authorization_code&code=...&client_id=...&client_secret=...&redirect_uri=...`;
   build the stored token value
   `{ access_token, refresh_token, expires_in, claimed_at: Math.floor(Date.now()/1000), token_url: tokenUrl, client_id, scope, token_type, data: <full response> }`
   (`claimed_at` in SECONDS; `Date.now()` here is an absolute-instant use —
   the narrow exception in date-handling.md). Upsert the connection row
   (`authType: "OAUTH2"`, `name` from state) + persist the token bag via
   `persistPieceConnectionSecrets`, then render the tiny HTML page that
   `postMessage`s `"app_oauth_completed"` and closes (copy from the Slack
   callback), falling back to a redirect to `path.to.workflowConnections`.
3. If the Slack install/oauth precedent's state helper turns out to be
   Slack-SDK-specific in a way that can't be reused, implement the local HMAC
   variant — do NOT add a dependency for it.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: passes
curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/api/integrations/pieces/slack/install" 2>/dev/null || echo "route check deferred to Task 20 (needs running stack + auth)"
# Expected at Task 20: 401/302 unauthenticated, JSON URL when authenticated with env creds set
```

**Out of scope:** PKCE (add only if the chosen starter OAuth piece declares
`pkce: true` — slack does not), token refresh (Task 10 owns it).

---

## Task 14: ERP — piece catalog in the builder (palette, node card, meta)

**Depends on:** Tasks 2, 6
**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/nodes/meta.ts` — `integration` in `NODE_KIND_META` + `NODE_KIND_ORDER`
- Modify: `apps/erp/app/modules/workflows/ui/Builder/nodes/kinds.ts` — macro-free per-kind facts
- Modify: the `nodeTypes` / `NODE_FORMS` records (find them: `grep -rn "NODE_FORMS\|nodeTypes" apps/erp/app/modules/workflows/ui/Builder/nodes/WorkflowNodeCard.tsx apps/erp/app/modules/workflows/ui/Builder/` — both are exhaustive `Record<WorkflowNodeType, …>` so the build fails until every site is filled)
- Create: `apps/erp/app/modules/workflows/ui/Builder/pieceCatalog.ts` — client access to `PIECE_CATALOG`
- Copy from (precedent): the `compute` kind's rows in the same files (nearest recently-added kind)

**Steps:**
1. `pieceCatalog.ts`: `export { PIECE_CATALOG } from "@carbon/pieces";`
   plus helpers `getPieceByKey`, `getPieceAction`, `pieceLogoUrl(key)`. Then
   check the erp client bundle impact: run the erp build and confirm the
   generated catalog lands in a lazy chunk or is acceptably sized (<300 KB
   gz). If the static import bloats the entry chunk beyond that, switch this
   file to `const load = () => import("@carbon/pieces")` with a
   suspense-friendly cache and update Tasks 15–16 call sites to the hook form.
   If BOTH approaches fail (bundler refuses the package), STOP and report —
   the fallback (an api route serving JSON) changes the design and needs a
   human decision.
2. `meta.ts`: `integration` entry — icon `LuPlug` (from `react-icons/lu`),
   label via the same `msg` mechanism as siblings, palette description
   ("Do something in a connected app"). `NODE_KIND_ORDER`: after `action`.
3. `kinds.ts`: card width + any macro-free facts the store/layout needs,
   mirroring the sibling entries.
4. Node card: the exhaustive records now force the form registration —
   register `IntegrationForm` (Task 15 creates it; to keep this task
   independently compilable, create the file in this task as a stub that
   renders `null` and let Task 15 fill it). Card summary line when collapsed:
   piece displayName + " · " + action displayName (resolved from
   `pieceCatalog.ts`, falling back to the raw ids). Card icon: `<img>` of
   `logoPath` with `LuPlug` fallback on error (precedent for img-with-fallback:
   `ItemThumbnail` pattern — grep `apps/erp/app/components` for it).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: passes — the exhaustive Records compile ONLY when every site is filled
pnpm --filter erp exec vitest run app/modules/workflows/ui/Builder/graph.test.ts
# Expected: still green (graph tests import kinds.ts, which must stay macro-free)
```

**Out of scope:** the form body (Task 15), options fetching (Task 16).

---

## Task 15: ERP — IntegrationForm (node config)

**Depends on:** Task 14
**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/config/forms/IntegrationForm.tsx` (stub from Task 14)
- Create: `apps/erp/app/routes/api+/workflows.piece-connections.ts` — resource route listing the company's connections for one piece
- Modify: `apps/erp/app/utils/path.ts` — `path.to.api.workflowPieceConnections(pieceKey)`
- Copy from (precedent): `apps/erp/app/modules/workflows/ui/Builder/config/forms/ActionForm.tsx` (`ActionPicker` Command-popover at ~L107–191, `renderInput` ordering at ~L380–465, `seededInputs`, required-before-optional sort), `apps/erp/app/components/Form/Location.tsx` `useLocations` (fetcher-based options hook)

**Steps:**
1. Structure (all edits funnel through `updateNodeData`, store-gated on
   `canChangeDefinition` — never a direct store write):
   a. **Piece picker**: Command popover over `PIECE_CATALOG` values (logo img,
      displayName, category badge), search by displayName. Selecting resets
      `action: ""`, `connectionId: ""`, `inputs: {}` and stores
      `piece: { name: meta.name, version: meta.version }`.
   b. **Action picker**: Command popover over the selected piece's kept
      actions (displayName + description). Selecting seeds `inputs` from prop
      `defaultValue`s (mirror `seededInputs`).
   c. **Connection select**: `useFetcher().load(path.to.api.workflowPieceConnections(pieceKey))`
      (hook shaped like `useLocations`); a plain Select of the returned
      connections; beneath it a "Connect <piece>" link opening the Connections
      drawer route (`connections.new`?piece=<key>) in a new tab — v1 keeps the
      inline-connect simple. When the fetched list is empty, show the
      unavailable-choice copy pattern ("Connect <piece> under Workflows →
      Connections first" — precedent: `fields/choiceOptions.tsx` Slack copy).
   d. **Props**: iterate the action's props, required first, then optional,
      `advanced: true` ones inside a `Disclosure`/collapsible "Advanced"
      section (grep `packages/react/src` for the existing disclosure/accordion
      component before writing one). Per type: MARKDOWN → render description
      as muted prose (no value); STATIC_DROPDOWN → `Select` over embedded
      options; STATIC_MULTI_SELECT_DROPDOWN → `MultiChoiceField`-style
      multi-select over embedded options; DROPDOWN / MULTI_SELECT_DROPDOWN →
      `DynamicOptionsField` (Task 16; render disabled "Select a connection
      first" until `connectionId` set); NUMBER/CHECKBOX/DATE_TIME →
      `ValueField` with the ValueType mapping from Task 6 step 4;
      SHORT_TEXT → `ValueField` (inline editor, `{` variables work);
      LONG_TEXT / JSON / OBJECT → `TemplateField` (multiline; JSON payloads
      read as written). Wrap every control in `fields/Field.tsx` (label =
      prop displayName, required star, per-field issue via `issueForField`).
2. The form declares `NodeFormProps<"integration">` — node data narrowing
   comes from the shared definition schema; never re-declare the shape.
3. Resource route `workflows.piece-connections.ts`:
   `requirePermissions({ view: "workflows" })`, query
   `getPieceConnectionsForPiece`, return `{ connections: [{ id, name, status }] }`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm exec biome check apps/erp/app/modules/workflows/ui/Builder
# Expected: both pass
```

**Out of scope:** the options round-trip body (Task 16); publish-time
validation (already done by NODE_KINDS checks, Task 6).

---

## Task 16: ERP — dynamic options route + `DynamicOptionsField`

**Depends on:** Tasks 9, 15
**Files:**
- Create: `apps/erp/app/routes/api+/workflows.piece-options.ts`
- Create: `apps/erp/app/modules/workflows/ui/Builder/fields/DynamicOptionsField.tsx`
- Modify: `apps/erp/app/utils/path.ts` — `path.to.api.workflowPieceOptions`
- Copy from (precedent): `apps/erp/app/routes/api+/quality.issue-types.ts` (resource-route shape), `packages/react` Combobox usage in `recordPickers.tsx`

**Steps:**
1. Route (POST): `assertIsPost`; `requirePermissions({ update: "workflows" })`;
   body `{ pieceKey, actionName, propertyName, connectionId, propsValue }`.
   Load the connection through the REQUEST's client (RLS applies — the
   builder user's own permissions, no owner indirection here), resolve
   secrets via `resolvePieceConnectionSecrets` + `getCarbonServiceRole()`,
   run OAuth refresh if needed (Task 10 export), then
   `runPieceCall({ kind: "options", ... }, adapters: in-memory no-op store/files, timeoutMs: 10_000 )`.
   Return `{ options: [{label, value}], disabled?, placeholder? }`; on any
   error return `{ options: [], disabled: true, placeholder: "Could not load options — check the connection." }`
   with status 200 (the builder must degrade, not error-boundary).
2. `DynamicOptionsField`: a Combobox that POSTs via `useFetcher` on open and
   whenever a `refresher` prop's current value changes (read refreshers from
   the prop meta; collect current literal values of those props from
   `node.data.inputs` — variables/refs among refreshers post as absent).
   Renders the disabled placeholder state verbatim when the route says so.
   Value commits through `updateNodeData` like every field; the stored value
   is a plain string literal (dropdown selections are never refs).
3. Both multi and single dynamic dropdowns share the field (multiple flag from
   the prop type).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: passes
# Behavior verified in Task 20 with a real key (or the degraded state with a fake one).
```

**Out of scope:** `refreshOnSearch`/searchValue (v1 omits type-to-search),
DYNAMIC properties (filtered out in Task 2).

---

## Task 17: Inject the piece catalog at every catalog construction site

**Depends on:** Tasks 2, 6
**Files:**
- Modify: every `createWorkflowCatalog(` call site — enumerate with `grep -rn "createWorkflowCatalog(" apps/ packages/ --include="*.ts" --include="*.tsx"`
- Known sites: `apps/erp/app/modules/workflows/ui/Builder/catalog.ts` (builder hook), `packages/jobs/src/workflows/engine/execute.ts` (done in Task 9 — verify), the publish/validate path in `apps/erp/app/modules/workflows/workflows.server.ts` (and the `$id.test-run.tsx` / manual-run path if it constructs its own)

**Steps:**
1. Run the grep; for EVERY hit, pass `PIECE_CATALOG` as the pieces argument.
   The builder site imports from `./pieceCatalog` (Task 14's client module);
   server/jobs sites import from `@carbon/pieces` directly.
2. A site intentionally left without pieces must gain a comment saying why
   (there should be none — an integration node validated against a
   piece-less catalog reports UNKNOWN and blocks publish, which is wrong
   everywhere the customer can reach).

**Verify:**
```bash
grep -rn "createWorkflowCatalog(" apps/ packages/ --include="*.ts" --include="*.tsx" | grep -v "PIECE_CATALOG\|pieces.ts\|catalog.ts:.*overlay?: \|test"
# Expected: zero un-injected production call sites (test files may use fixtures)
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/jobs
# Expected: passes
```

**Out of scope:** `createFixtureCatalog` test sites (fixtures stay fixtures).

---

## Task 18: Run history naming for integration steps

**Depends on:** Tasks 14, 17
**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Runs/useNodeLabel.ts` — integration steps title
- Modify (if needed): `apps/erp/app/modules/workflows/ui/Builder/labelKeys.ts` — `nodeTitle` fallback for the kind
- Copy from (precedent): the existing action-step naming path in the same files (`.claude/rules/workflow-run-history.md` §"Naming a step row")

**Steps:**
1. Read `useNodeLabel.ts`. When the step's node is an integration node whose
   `name` is still auto-generated (`isDefaultNodeName`), fall back to
   "<piece displayName>: <action displayName>" resolved from `PIECE_CATALOG`
   via Task 14's `pieceCatalog.ts` (raw ids when the piece left the manifest —
   never blank). `metaForNodeType` already resolves the icon via `meta.ts`
   (Task 14).
2. Confirm `redactForLog` needs NO change: connection secrets never enter the
   executor's recorded inputs (Task 9 passes them harness-side only), and
   `access_token`/`secret_text` keys match the existing SECRET_KEY regex
   anyway. This is a read-and-confirm step — if you find a path where the
   auth value lands in `ctx.record` or step `input`, STOP and report.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: passes; visual confirmation in Task 20
```

**Out of scope:** retention, detail column, run-history schema (unchanged by
design).

---

## Task 19: i18n extract + full validation sweep

**Depends on:** all prior tasks
**Files:**
- Modify: `packages/locale/locales/*/erp.po` (via extract only)

**Steps:**
1. `pnpm lingui:extract` (new UI strings from Tasks 12/14/15/16). Piece
   display names/descriptions are runtime data and deliberately NOT extracted.
2. Full scoped sweep:

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/workflows --filter=@carbon/pieces --filter=@carbon/jobs --filter=@carbon/env --filter=erp
# Expected: all pass
pnpm --filter @carbon/workflows test && pnpm --filter @carbon/pieces test && pnpm --filter @carbon/jobs test
# Expected: all green
pnpm run lint
# Expected: no errors
pnpm run check:workflow-catalog && pnpm run check:piece-catalog
# Expected: both green
```

**Out of scope:** committing (the user commits, or /check-and-commit on
explicit ask — never auto-commit).

---

## Task 20: Browser verification via /test

**Depends on:** Task 19
**Files:** none (verification only; playbook lands in `.ai/playbooks/`)

**Steps:**
1. Ensure the local stack is up (`crbn up`, portless `*.dev`). Invoke the
   /test skill against this branch's diff with this scenario:
   a. Log in (/auth), open Workflows → Connections; create a connection for
      an API-key piece (e.g. OpenAI) with a placeholder key. Verify the row
      appears, and via psql that `pieceConnection.config` contains NO secret
      and `secretRef` is set.
   b. Open a workflow in the builder; add an Integration node from the
      palette; pick the piece + an action; verify required-prop validation
      issues appear and clear; wire an upstream variable into a text prop.
   c. Select the connection; publish; trigger the workflow (create the
      triggering record). EXPECTED with a placeholder key: the run's
      integration step settles **Failed** with the provider's auth error as
      the step error — that is END-TO-END PROOF (resolution → secret fetch →
      child process → real HTTP → outcome mapping → run history). No secret
      may appear anywhere in the run detail (inspect the step input/output).
   d. If `OPENAI_API_KEY`-style real credentials are available in the local
      env, repeat with a real key and verify the step Succeeds and downstream
      `result.<field>` references resolve.
   e. Screenshot the connections page, the configured node, and the run
      detail for the PR (house rule: net-new UI ships with screenshots).
2. Dynamic dropdown check: with a fake key, open a dynamic dropdown (e.g.
   OpenAI model picker if kept, else Slack channel with no connection) and
   verify the degraded "Could not load options" state renders instead of an
   error boundary.

**Verify:**
```bash
# The /test skill's own pass/fail is the verification; its playbook is cached to .ai/playbooks/
# Expected: scenario (a)-(c) pass; (d) only with real creds; screenshots saved
```

**Out of scope:** real OAuth end-to-end (needs a registered dev app +
`PIECES_OAUTH_SLACK_*` env — flag as follow-up verification for Brad),
performance testing, trigger phases.
