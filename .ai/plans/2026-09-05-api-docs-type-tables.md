# Accurate, drill-down type tables for the API docs (zod-v4-native)

Branch: `feat/carbon-api-orpc` (all prerequisites now live here — no stacking).
Supersedes the pre-zod-v4 draft that planned this as a stacked PR.

## What changed since the first draft

- **Zod 4.5.4 is merged to main** ([#1576](https://github.com/crbnos/carbon/pull/1576)) and main is
  merged into this branch (`c9ee69661f`). The "upgrade zod first" prerequisite is DONE.
- `z.toJSONSchema(validator, { io, unrepresentable: "any" })` is available natively — no
  third-party converter. **Probed 2026-09-05 against real Carbon validator shapes** (results
  below) — the accuracy bar ("drill-down + correct values or it's not worth it") is achievable.
- The refined item validators now carry both generics (`z.ZodType<z.infer<T>, z.input<T>>`,
  restored in `fa790a9410`), so `z.input`/`z.output` distinction is intact end to end.

## Grounding facts (verified on this branch, 2026-09-05)

**Probe results — `z.toJSONSchema(v, { io: "input", unrepresentable: "any" })`:**

| Validator shape | Emitted (input side) |
|---|---|
| `z.enum([...])`, incl. inside `z.preprocess` | real `enum: [...]` values ✓ |
| nested `z.object` | `properties` + `required`, recursive ✓ |
| `.default(1)` | `default: 1` annotation AND omitted from `required` ✓ |
| `zfd.text(z.string().optional())` | optional `{type:"string"}` ✓ (pipe input side resolves through the transform) |
| `zfd.numeric(z.number().min(0).max(1))` | `{type:"number", minimum, maximum}` ✓ |
| `z.record(z.string(), z.number())` | `additionalProperties: {type:"number"}` (+ `propertyNames`) ✓ |
| refined objects (`applyStorageAndShelfLifeRefines` output) | converts fine, all keys preserved ✓ |
| `zfd.checkbox()` | `anyOf: [{const:"on"}, {}, {type:"boolean"}]` — FormData-truthful but noisy → **normalize** (below) |

**`io: "output"` is available but NOT the manifest schema.** Output = the post-parse shape the
service receives (defaults required, transforms applied, checkbox → `{}`), not the API response.
The caller contract is the INPUT side; use it for the manifest/OpenAPI/docs. Response types still
need ReturnType reflection — stays deferred (see Non-goals).

**The transport already forwards whatever the manifest says, verbatim:**
- `apps/erp/app/routes/api+/v1+/lib/router.server.ts` → `.input(jsonSchema(meta.schema))`;
  `packages/api/src/schema.ts` wraps the precomputed JSON Schema as a pass-through Standard
  Schema and `CarbonJsonSchemaConverter` emits it verbatim into the OpenAPI spec.
- MCP `describe_tool`/`search_tools` and the docs generator read the same manifest.
- So Phase 1's richer schemas reach the v1 OpenAPI spec, MCP, and the docs **with zero
  transport changes**. The v1 dispatcher reads only `serviceParams`/`injectAuth`/
  `schema.properties._operation` — richer property schemas cannot break dispatch.

**Generator today:** `scripts/lib/service-metadata.ts` (880 lines, this branch) regex-parses
validator SOURCE text; `parseValidatorFields` resolves `z.infer<typeof X>` textually. That
textual resolution is what Phase 1 replaces with a real import + native conversion. 351 service
params are `z.infer<typeof …>` against 419 validators in the `{module}.models.ts` files.

**Manifest regression tests:** `apps/erp/test/mcp-tool-metadata.test.ts` pins semantic shapes
(array-of-objects `items.properties` sans `createdBy`, DESTRUCTIVE classification, `_operation`).
These should PASS with better schemas; adjust only literal expectations that shift.

## Phase 1 — validator-backed schemas via native conversion

- [ ] In `scripts/lib/service-metadata.ts`: when a param matches `z.infer<typeof X>` (the
      textual detection already yields the validator NAME + module), dynamically import the
      module's models file (`{mod}.models.ts` / `.ee.models.ts` — client-safe by construction,
      tsx can load them) and convert through one seam:
      ```ts
      import { z } from "zod";
      function toJsonSchema(v: z.ZodType): Record<string, unknown> {
        return z.toJSONSchema(v, { io: "input", unrepresentable: "any" });
      }
      ```
- [ ] **Normalization post-pass** (runs on the converted schema before manifest write):
      1. Drop the `$schema` key.
      2. Collapse the zfd-checkbox shape (`anyOf` of `{const:"on"}`/`{}`/`{type:"boolean"}`)
         to `{type:"boolean"}` — JSON callers send booleans; the "on" member is FormData plumbing.
      3. Flatten any `$defs`/`$ref` the converter emits for reused sub-schemas (default is
         inline; verify). A truly cyclic validator → fallback (next item).
- [ ] **Fallback per validator, never silently degrade**: if import or conversion throws, keep
      the existing textual schema for that op and record it in the diff report.
- [ ] Post-conversion invariants unchanged and re-asserted: strip `CONTEXT_PARAMS` (top level
      AND array `items.properties`), single-object flattening, `_operation` injection after
      conversion, blocked tools/descriptions/classification/injectAuth/permission untouched.
- [ ] `(typeof X)[number]` params (today → bare `"string"`): import the const array from the
      models module, emit a real `enum: [...]`.
- [ ] **Diff report**: old→new manifest comparison printing per-op gained/changed properties,
      enums surfaced, nested depth — the accuracy evidence. Exemplars to spot-check:
      `sales_copyQuote.type` (enum `item|quoteLine|method|quoteToQuote`),
      `production_buildAssemblyToolStepLinks` (nested `sourceSteps` items),
      `production_getJobMaterialsWithQuantityOnHand` (depth-2 + defaults).
- [ ] Determinism: generator twice, empty diff. Run manifest tests + `orpc-mechanics.test.ts`;
      `pnpm exec turbo run typecheck --filter=erp --filter=@carbon/api`;
      `pnpm run check:workflow-catalog` (same manifest feeds it).
- [ ] Verify flow-through: `GET /api/v1/openapi.json` carries the richer input schemas
      (spot-check one path's requestBody); MCP `describe_tool` on an exemplar returns them.

## Phase 2 — `SchemaTable`: recursive, expandable type table (docs)

Decision reaffirmed: custom component, NOT fumadocs `AutoTypeTable` — it reflects TS types from
`.ts` files (not JSON Schema), and the repo already re-implemented TypeTable as `<FieldTable>`
for styling reasons. Both are zod-version-independent.

- [ ] New `docs/components/api/schema-table.tsx` (`"use client"`): recursive JSON-Schema
      renderer in the warm-paper style, accordion interaction modeled on
      `docs/components/editorial/field-table.tsx`, row anatomy on `docs/components/api/fields.tsx`.
      Per row: name (mono), type label, `required`/`optional` badge, `default` badge, description.
      Expansion cases (all shapes verified in the probe):
      - `enum` → label `enum`, expand reveals value chips; ≤4 values may render inline.
      - `object` + `properties` → expand recurses (data max depth 2; component arbitrary).
      - `array` + `items.properties` → label `object[]`, expand into element rows; primitive
        arrays label `string[]` etc., no chevron.
      - `record` (`additionalProperties` object w/o `properties`) → label like
        `Record<string, number>`; drill into the value schema when it's an object.
      - union `["string","null"]` → `string | null`; other `anyOf` → joined labels.
      - `{}` → `any` (accurate for `Json`-typed props).
      Rows with nothing to expand render without a chevron.
- [ ] `docs/app/api/operations/[operation]/page.tsx`: replace the flat `Parameters`/`propType`
      block with `<SchemaTable schema={t.schema} />`. Keep "Call it" + raw "Input schema".
      `_operation` renders as an ordinary required enum (it IS the caller contract).
- [ ] `exampleArgs`: enum fields use their first enum value instead of `"string"`.

## Phase 3 — Data API pages: enums + response fields

- [ ] `docs/scripts/generate-api-docs.mjs` `attributesFrom`: carry `enum: p.enum` and
      `default: p.default` into the attribute; extend `ApiAttribute` in `docs/lib/api-types.ts`.
      (The swagger already holds the values — 372 enum lines in `swagger-docs-schema.ts`.)
- [ ] `docs/components/api/fields.tsx`: enum rows become expandable (share the SchemaTable row
      shell), revealing values under the named type (`maintenanceDispatchStatus` → its 5 values).
      JSONB stays `json` — no invented structure.
- [ ] Response fields for reads: list/retrieve endpoints get `responseAttributes` (the table's
      own columns ARE the row shape PostgREST returns) rendered as a collapsed "Response fields"
      table in `endpoint-section.tsx`/`code-panel.tsx`, next to the example JSON.
- [ ] `pnpm --filter docs build` green.

## Unlocked but deferred (each needs a user go-ahead)

- **Runtime input validation on v1**: `packages/api/src/schema.ts`'s `validate()` is a
  deliberate pass-through (parity with MCP). Now that carried schemas are real, Ajv over the
  carried JSON Schema — or importing the actual validators per-op — would give callers proper
  400s with field errors. Separate change; don't fold into this PR.
- **Operation RESPONSE schemas** (docs + oRPC `.output()`): needs ReturnType reflection over
  service functions (unwrap `Promise<PostgrestResponse<…>>`) — `io: "output"` does NOT provide
  this (it's the validator's post-parse shape, not the service return). Revisit after Phase 1.
- **Deprecated-form modernization** (`errorMap:`→`error:` style sweep, `.merge()`→`.extend()`):
  still works under v4; a later cleanup.

## Verification

1. Diff report reviewed (exemplars show real enums/nesting); double-run determinism; manifest +
   oRPC mechanics tests; erp/@carbon/api typecheck; workflow-catalog check.
2. Live: `describe_tool` + `/api/v1/openapi.json` on the running stack carry richer schemas.
3. Docs dev server: `/api/operations/sales_copyQuote` expands enum values;
   `production_buildAssemblyToolStepLinks` drills into `sourceSteps`; a Data API resource page
   expands a named enum and shows Response fields on GET. Then clean `pnpm --filter docs build`.
4. Commit per phase via /check-and-commit.

## Key files

Modify: `scripts/lib/service-metadata.ts` (+`toJsonSchema` seam + normalization pass),
`scripts/generate-mcp.ts` (diff-report flag), regenerated
`apps/erp/app/routes/api+/mcp+/lib/tool-metadata.json`,
`docs/app/api/operations/[operation]/page.tsx`, `docs/components/api/fields.tsx`,
`docs/scripts/generate-api-docs.mjs`, `docs/lib/api-types.ts`,
`docs/components/api/{endpoint-section,code-panel}.tsx`.
Create: `docs/components/api/schema-table.tsx` (+ shared row shell), diff-report helper in
`scripts/lib/`.
