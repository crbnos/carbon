# MCP generator: replace hand-rolled TypeScript parsing with ts-morph

> Status: draft
> Author: Sidwebworks
> Date: 2026-10-01

## TLDR

`scripts/lib/service-metadata.ts` derives the entire MCP / v1-API operation
manifest (1557 tools) by parsing TypeScript as **text** — 105 regexes, a
hand-rolled type parser, a brace/comment scanner, and body substring scans.
The robust tool for this is already a dependency of the same generator:
`scripts/lib/response-schema.ts` builds a real ts-morph `Project` off the ERP
tsconfig and reflects return types through the actual TypeChecker. This spec
migrates the textual half onto that same `Project`, in four phases, deleting
~750 lines while keeping `buildAllToolMetadata` synchronous and pure. Phases 0–2
are digest-neutral by construction; Phase 3 (type resolution) is expected to
refine ~531 param schemas and is reviewed by spot-check per category.

## Problem Statement

The generator has two halves that answer the same question with different
machinery, in the same run, over the same files.

`response-schema.ts:17` imports ts-morph, and at `:271-280` it builds a
`Project` from `apps/erp/tsconfig.json`, adds exactly the three files per module
(`{mod}.service.ts`, `{mod}.ee.service.ts`, `{mod}.mcp.server.ts`), calls
`project.resolveSourceFileDependencies()`, and iterates
`source.getFunctions().filter(f => f.isExported())`. It reflects 1493/1574
return types in ~4s.

`service-metadata.ts` re-derives the same file list with `fs.existsSync` and the
same function list with `/export\s+(?:async\s+)?function\s+(\w+)\s*\(/g`, then
hand-parses types, JSDoc, and function bodies from strings.

Measured against the current file (1675 lines, i.e. after the fallback deletion
in `5c90a8df30`), 752 lines (44%) are work the compiler in the same process has
already done:

| Lines | Layer | Functions |
|---|---|---|
| 199 | text scaffolding | `skipComment`, `findMatchingBrace`, `splitAtTopLevel`, `isArrowClose`, `findTopLevel`, `stripComments`, `extractFunctionBody`, `precedingJsdoc`, `parseExportedFunctions`, `destructuredParamName`, `inferTypeFromDefaultLiteral` |
| 498 | TS type parser | `typeToJsonSchema`, `genericInner`, `wrapsWholeType`, `resolveNestedInferType`, `resolveInferExpression`, `parseInlineObjectType`, `splitObjectFields`, `resolveTypeAlias`, `lookupValidatorSchema` |
| 55 | body substring scans | `classifyFunction`, `functionBodyDeletes`, `functionBodyPaginates`, `functionBodyTables`, `usesOperationDiscriminator` |

Concrete defects this shape causes today:

1. **`extractFunctionBody` resolves the wrong body for a shadowed function.** It
   regex-matches the first `export function <name>(` in `service + "\n" +
   mcpServer` concatenated content, so a `mcp.server.ts` wrapper's classification,
   pagination and table scans are taken from the *service* body it shadows. The
   file's own comment admits this. One function is affected today
   (`production.upsertJobMaterial`).
2. **An exported arrow function is invisible.** `production.getPartDocuments` is
   `export const … = async (…) =>`, which the regex never matches, so it is
   absent from the manifest with no diagnostic. It is the only one today.
3. **Body scans are substring matches, not call sites.** "Does `.delete(` appear
   in this text" cannot distinguish a real call from a comment, a string, or a
   nested closure. `no-missing-audit-column` in `@carbon/checks` had two
   false-positive classes from exactly this style of matching (PR #1777 review),
   which is the same bug shape one layer out.
4. **No safety net.** Nothing typechecks or lints `scripts/`: root
   `tsconfig.json` is `{}` and biome's `files.includes` is
   `(apps|packages|docs)/**`, so `biome check scripts/…` reports "Checked 0
   files". That is how this file reached 105 regexes unnoticed.

What is **not** wrong, and bounds the ambition here: the type parser is
currently producing good output. 1434 of 1557 tools (92%) have a non-empty param
schema, and the single non-READ tool with an empty one legitimately takes zero
user params. This is a maintainability and robustness change, not a bug fix.

### Prior work already landed

Commit `5c90a8df30` deleted the source-text zod fallback
(`parseValidatorFields`, `extractValidatorRhs`, `parseFirstZObject`,
`zodExprToJsonSchema`, 160 lines) after instrumentation showed all 342 `z.infer`
params resolve `native` and the fallback fired zero times, and made a module
load failure refuse to write rather than publish a lossy manifest. That is the
precedent this spec follows: measure the route, delete what never runs, fail
loudly instead of degrading.

## Proposed Solution

Hoist one shared ts-morph `Project`, hand it to both halves of the generator as
data, and replace each textual layer with the equivalent AST/TypeChecker query.

`buildAllToolMetadata` stays **synchronous and pure** — the property its design
comment deliberately protects. ts-morph's API is synchronous, so the `Project`
is passed in exactly as `validators` and `responses` already are.

### Phases

Each phase is its own commit with its own digest verdict, so a churn diff is
never mixed with a refactor diff.

**Phase 0 — floor.** Add `scripts/tsconfig.json` extending the repo base, add
`scripts/**` to biome's `files.includes`, and add both to the CI `Typecheck` and
`Lint` jobs. Fix the pre-existing errors this surfaces (measured: 33 across ~10
files with an ad-hoc `tsc` invocation; a real tsconfig extending the base should
resolve the subset that came from `packages/database` being pulled in with the
wrong module resolution). Also bump `ts-morph` 22.0.0 → 28.0.0 in this phase, on
its own commit: ts-morph carries its own TypeScript (22 bundles
`@ts-morph/common@0.23`, ≈ TS 5.4) while the repo compiles on 5.8.3, so
`response-schema.ts` currently reflects types with an older compiler than the
one that typechecks the tree. Any digest movement from the bump must be
attributable to the bump alone. Digest verdict: **must be unchanged**.

**Phase 1 — discovery and JSDoc.** Replace `parseExportedFunctions`,
`precedingJsdoc`, `destructuredParamName` and `inferTypeFromDefaultLiteral` with
`source.getFunctions()`, `fn.getJsDocs()`, `param.getName()` and
`param.getInitializer()`, reading from the shared `Project`. Shadowing becomes
explicit: the `mcp.server.ts` declaration wins, and its OWN body is the one
scanned. Additionally collect exported arrow functions
(`getVariableStatements()` whose initializer is a function), and add
`production_getPartDocuments` to `MCP_BLOCKED_TOOL_NAMES` with the rest-param
reason (below). Digest verdict: **must be unchanged** — verified below.

**Phase 2 — body scans.** Replace the five substring scans with
`fn.getDescendantsOfKind(SyntaxKind.CallExpression)` queries: a `.delete()` /
`.deleteFrom()` call for `classifyFunction`, `setGenericQueryFilters` / `.range`
for `functionBodyPaginates`, `.from("t")` / `insertInto("t")` /
`updateTable("t")` string-literal arguments for `functionBodyTables`, and the
`_operation` discriminator for `usesOperationDiscriminator`. Digest verdict:
**must be unchanged**.

**Phase 3 — type resolution.** Replace the 498-line type parser with
`param.getType()` plus the `typeToJsonSchema` walker `response-schema.ts`
already owns, extracted so both the param side and the return side share one
implementation. The zod path is untouched: a `z.infer<typeof v>` param keeps
resolving through the loaded validator and `z.toJSONSchema`. Digest verdict:
**churn expected and accepted** — see Risks.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Parser technology | ts-morph, already a dependency | `response-schema.ts` already builds a `Project` over the same files in the same run. This is deduplication, not a new dependency. Rejected `ts-json-schema-generator` (duplicates the walker we own, and cannot see supabase-js's select-string inference the checker already resolves) and swc/oxc/tree-sitter (fast parsers, no type resolution — every type bug would survive) |
| `Project` lifetime | One, built once, passed into both halves | Removes a second ~4s parse; `resolveSourceFileDependencies()` is the expensive step and is already paid once |
| `buildAllToolMetadata` shape | Stays sync + pure | ts-morph is synchronous, so the existing "hoist the expensive work, pass results in as data" design survives unchanged. This is the property that makes the builder testable |
| Phase ordering | Floor → discovery → body scans → types | Puts all three digest-neutral phases before the one that churns, so a reviewer never reads a mixed diff |
| ts-morph version | Bump 22.0.0 → 28.0.0 in Phase 0, separate commit | ts-morph bundles its own TypeScript; 22 is ≈ TS 5.4 against the repo's 5.8.3. Bumping inside a later phase would make a compiler-version digest change indistinguishable from a refactor bug |
| Arrow-function exports | Collect them; block `production_getPartDocuments` | Closes the discovery blind spot structurally for every future arrow export. That one function is variadic (`...items: Array<{itemId: string}>`) and the MCP dispatcher builds a named-key JSON payload, so publishing it would ship a tool that can never validate — the same reason `production_returnPickedRemainders*` are already blocked |
| Digest churn review (Phase 3) | Accept the compiler's output; spot-check per category | ~531 params sit in the two shapes where the string parser is weakest. Justifying all of them individually would stall the phase; requiring zero churn would make it unlandable. Spot-check one sample per category (inline object, generic, bare alias) and record the counts in the PR |
| Heuristic 1–6 (multi-tenancy, service shape, RLS, permissions, forms, module layout) | N/A | No database, service, route, form or module change. This touches build tooling under `scripts/` only |
| Heuristic 7 (backward compatibility) | Tool schemas are not a listed contract surface; treat Phase 3 as additive-in-spirit | `BACKWARD_COMPATIBILITY.md` lists Database Schema, Permission Scope Strings, RLS Policy Names, Service Function Signatures, Route Paths, Edge Function Names, Event Types, Component Props, Import Paths and Model Validators. The generated manifest is none of them, and it is regenerated from source on every `postinstall`. Phase 3 must still not *remove* a published field: a param that has a schema today keeps one |
| Competitor research (`/research`) | N/A | This is internal build tooling with no ERP domain logic. The skill's research gate exists so domain behaviour is not invented; there is no domain behaviour here |

## Data Model Changes

None. No migration, no table, no column. This spec changes only
`scripts/**`, `apps/erp/app/routes/api+/mcp+/lib/mcp-blocked-tools.ts`,
`biome.jsonc` and `.github/workflows/check.yml`.

## API / Service Changes

No service function changes. The generator's internal contract changes:

- `BuildOptions` gains `project: Project` (the shared ts-morph project).
- `ParsedFunction` is replaced by, or backed by, a ts-morph
  `FunctionDeclaration` / `VariableDeclaration`, so `params` carries real `Type`
  objects instead of `typeStr` strings.
- `buildAllToolMetadataWithValidators` builds the `Project` alongside the
  validator registry and the response index, and passes all three in.
- `MCP_BLOCKED_TOOL_NAMES` gains `production_getPartDocuments`.

The published artifacts (`tool-metadata.json`, `tool-manifest.digest.json`) keep
their exact shape. `manifest-digest.ts` is untouched, so `check:manifest`
remains the oracle throughout.

## UI Changes

None.

## Acceptance Criteria

- [ ] `pnpm run generate:mcp` after Phase 0, 1 and 2 leaves
      `tool-manifest.digest.json` byte-identical — `sha256` matches
      `48b51bb5116e583aae5ca3490fcdf010b29833ba4553173961807ff97f47d624` and
      `git diff` on the file is empty
- [ ] `pnpm run check:manifest` prints `digest current` after every phase
- [ ] `production_upsertJobMaterial` is derived from the `mcp.server.ts`
      wrapper's own body after Phase 1, and its digest entry is unchanged
      (verified: the wrapper and the service body yield identical scan results —
      0 `.delete(`, 0 pagination, 0 `_operation`; the wrapper names two tables so
      the audit-column drop stays inapplicable either way)
- [ ] `production_getPartDocuments` is discovered by the generator and excluded
      by `MCP_BLOCKED_TOOL_NAMES`, so `totalTools` stays 1557
- [ ] A new exported arrow function in a service file appears as a tool without
      any generator edit (add one in a scratch commit, confirm, revert)
- [ ] A new exported function with a rest parameter is reported by name at
      generate time rather than published as an uncallable tool
- [ ] Phase 3: every tool that has a non-empty param schema today still has one
      (no field loss); the PR body records changed-entry counts per category
      with one spot-checked example each
- [ ] `scripts/**` is covered by `pnpm run typecheck` and `pnpm run lint`, both
      green, and CI runs them
- [ ] `pnpm exec turbo run typecheck --filter='*' --concurrency=1` is 33/33 and
      `pnpm run test` is green after each phase
- [ ] `service-metadata.ts` is under 950 lines with no `findMatchingBrace`,
      `stripComments`, `extractFunctionBody` or `splitAtTopLevel`

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Phase 3 silently drops a param schema, publishing `{}` where a real schema belonged — an MCP client then guesses field names and the guess reaches an insert (the PGRST204 shape) | High | Assert per-tool that a non-empty schema never becomes empty, as a generate-time refusal, not a review step. `generate:mcp` already refuses to write on unresolved validators; extend the same gate |
| Phase 3 churn is large enough to be unreviewable | Medium | Bounded by measurement: 531 of 2338 user params (23%) sit in the two weak shapes; 67% are primitives the compiler treats identically. Spot-check per category, record counts. If churn exceeds ~200 entries, split Phase 3 by shape (generics first, inline objects second) |
| ts-morph 28 resolves types differently from 22, moving the digest for reasons unrelated to the refactor | Medium | Phase 0 bumps it alone, with the digest as the verdict. A change there is investigated before any refactor lands on top |
| Sharing one `Project` couples the two halves, so a failure in one takes out both | Low | It already is one program in practice; a file that will not parse breaks return-type reflection today. `generate:mcp` refuses to write on failure |
| Phase 0 surfaces pre-existing `scripts/` errors that balloon the change | Medium | 33 measured with ad-hoc flags; a real `scripts/tsconfig.json` extending the repo base should drop the ones caused by wrong module resolution. If the genuine remainder is large, fix them in a dedicated commit before the tsconfig is wired into CI, so the gate lands green |
| Peak memory: one `Project` over every service file plus `resolveSourceFileDependencies` | Low | Already paid by `response-schema.ts` today (~4s, no OOM). Whole-repo `tsgo` is the known memory hazard, not this |
| Behaviour change hides in a "digest-neutral" phase because the digest hashes schemas rather than storing them | Low | The digest stores `schema` and `response` as hashes, so any schema change does move it. Field-level drift cannot hide behind an unchanged hash |

## Open Questions

> HARD STOP: Do not proceed with implementation until these are answered.

All resolved with the user on 2026-10-01 before this spec was written.

- [x] Does Phase 3 (the 498-line type parser) happen at all, given the parser
      currently works — 92% of tools have real schemas and the only non-READ
      tool with an empty one legitimately takes zero params — so the change is
      maintainability against churn on a generated public contract?
      — **Answer:** Both phases. Do the digest-neutral work first, then the type
      parser. The duplication and fragility are worth removing even without a
      forcing bug; the phase split keeps the churn isolated and reviewable.
- [x] `production.getPartDocuments` is an exported arrow function and is
      invisible to the manifest today. Preserve the omission, or collect arrow
      functions?
      — **Answer (after re-ask):** Collect them structurally, and block this one.
      The first answer was "include it", which conflicts with the code: the
      function is variadic (`...items: Array<{itemId: string}>`) and the MCP
      dispatcher builds a named-key JSON payload, so publishing it would ship a
      tool that can never validate — exactly why
      `production_returnPickedRemaindersForOperation/ForJob` are already on
      `MCP_BLOCKED_TOOL_NAMES`. It is also the only rest-param export in the
      tree, so the generator has no precedent for handling one. Resolution:
      collect arrow functions, add `production_getPartDocuments` to the blocked
      list with that reason, and report any future rest-param export by name at
      generate time.
- [x] How is the Phase 3 digest diff reviewed — justify every changed entry,
      accept and spot-check, or require zero churn?
      — **Answer:** Accept the compiler's output as authoritative, spot-check a
      sample per category (inline object, generic, bare alias), and record the
      counts. Justifying each entry would stall the phase; requiring zero churn
      would make it unlandable. Paired with the hard generate-time assertion
      that no tool loses a schema it already had.
- [x] `scripts/` has no typecheck or lint coverage — fold that into this spec or
      raise it separately?
      — **Answer:** Fold it in, as Phase 0, so the migration lands on a floor
      that catches drift. Cost acknowledged: 33 pre-existing errors measured
      across ~10 files, some of which are artifacts of ad-hoc `tsc` flags rather
      than real defects.

## Changelog

- 2026-10-01: Created. Open questions resolved with the user before writing
  (four asked, one re-asked after the answer contradicted the variadic signature
  in `production.service.ts`). Measurements taken against commit `5c90a8df30`:
  1557 tools, 1675 lines in `service-metadata.ts`, 752 replaceable, 2338 user
  params by shape, digest `sha256 48b51bb5…`.
