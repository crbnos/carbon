# Onshape Configuration Import

> Status: draft
> Author: Claude (autonomous mode — open questions resolved without a grill at Brad's instruction, 2026-08-26)
> Date: 2026-08-26
> Research: `.ai/research/2026-08-26-onshape-configuration-import.md`
> Related: `.ai/specs/2026-08-04-solidworks-pdm-integration.md` (sibling CAD integration; unaffected)

## TLDR

Carbon's Onshape BOM import (`OnshapeSync` → Document → Version → Assembly → Sync) never
passes a `configuration` parameter, so it silently imports whatever Onshape's **default**
configuration resolves to. A customer with a configured assembly — the ordinary case for
anyone using Onshape configurations — cannot import the variant they actually sell. This
spec adds a fourth step to the existing cascade: after picking an assembly, Carbon asks
Onshape whether that element has configuration parameters, and **iff it does**, renders one
control per parameter. The chosen values are encoded through Onshape's own encoding
endpoint server-side and passed to the BOM call, then persisted on the item's
`externalIntegrationMapping` so a re-sync reproduces the same variant.

No schema migration, no new table, no edge-function change. Four files touched in
`packages/ee` + `apps/erp`, plus one new API route. Phase 2 (separable) closes a latent
last-writer-wins overwrite in the webhook-driven asset sync, which discards the
`configuration` field Onshape already sends on every released revision.

## Problem Statement

- **Wrong variant, silently.** `OnshapeClient.getBillOfMaterials`
  (`packages/ee/src/onshape/lib/client.ts:260`) hardcodes its query string with no
  `configuration`. Onshape interprets an absent `configuration` as "the default
  configuration", so a user importing a configured assembly gets a BOM that looks
  plausible and is wrong for every variant but one. There is no error, no warning, and
  nothing in the imported make method records which variant it came from.
- **No way to ask for a different one.** The picker in
  `apps/erp/app/components/OnshapeSync.tsx` stops at the assembly element. Nothing in the
  UI, the route layer, or the client can express "the 500 mm / MALE / left-hand variant".
- **The capability is already half-built and unreachable.**
  `createAssemblyTranslation` and `createPartStudioTranslation` (`client.ts:398`, `:366`)
  both already accept `configuration?: string` and forward it into
  `BTTranslateFormatParams`. No caller has ever set it. The asset-sync path therefore
  exports default-configuration geometry to sit next to a default-configuration BOM —
  consistent, but consistently wrong for configured customers.
- **A latent overwrite in the release path (Phase 2).** `BTRevisionInfo` carries a
  `configuration` field. `OnshapeRevision` (`client.ts`) does not declare it, so
  `onshape-revision-sync.ts` and `onshape-backfill.ts` never see it. Two configurations
  released under the **same** part number collapse onto one
  `releaseKey(partNumber, revision)` (`onshape-matching.ts`), match the same Carbon item,
  and the attach helper's replace-not-append rule makes it last-writer-wins — a silent
  geometry overwrite with no error and no skip reason.

## Proposed Solution

### Shape of the change

One new link in the existing fetcher cascade. `OnshapeSync` already runs
Document → Version → Assembly, each step firing its own `useFetcher` on the previous
step's change. Configuration detection is a fourth link fired on `elementId` change:

```
documents ──▶ versions ──▶ elements ──▶ configuration (NEW)
                                             │
                              configurationParameters.length > 0 ?
                                    ├── yes → render controls
                                    └── no  → render nothing (today's UI, unchanged)
                                             │
                                        Sync ──▶ BOM (+ configuration) ──▶ Save
```

### Detection

```
GET /api/v10/elements/d/{did}/v/{vid}/e/{eid}/configuration
→ { configurationParameters: [...], currentConfiguration: [...], serializationVersion, sourceMicroversion }
```

The predicate is `(configurationParameters?.length ?? 0) > 0`. `{wvm}` accepts `v`, so this
works at the version the picker is scoped to (only the *update* form is workspace-only).

The element listing (`getElementsInDocument` → `BTDocumentElementInfo`) carries **no**
configuration signal — verified against the full property set in the research — so this
cannot be folded into the fetch Carbon already makes. It costs exactly one extra request,
made once, after the user has committed to an assembly. There is no batch form, so
detection is never run across the whole element list.

### Parameter → control mapping

Each entry is a `BTMConfigurationParameter` discriminated on `btType`, with
`parameterType` ∈ `ENUM | BOOLEAN | STRING | QUANTITY`.

| `parameterType` | Type-specific fields | Carbon control (`@carbon/react`) |
|---|---|---|
| `ENUM` | `options[] { option, optionName }`, `defaultValue` | `Combobox` — `value: option`, `label: optionName` |
| `BOOLEAN` | `defaultValue: boolean` | `Switch` |
| `QUANTITY` | `quantityType`, `rangeAndDefault { minValue, maxValue, defaultValue, units }` | `Number` with `minValue`/`maxValue`, unit shown as a suffix label |
| `STRING` | `defaultValue: string` | `Input` |

All four are handled, not just `ENUM`. A single element mixes them freely — an assembly
with a `List` *and* a length parameter is ordinary — and rendering only the dropdowns would
submit a silently incomplete configuration.

Every control is prefilled from its `defaultValue` / `rangeAndDefault.defaultValue`, so the
initial state reproduces today's behavior exactly. The user must actively change something
to get a different import.

### Encoding

Values are never hand-assembled into a configuration string. Parameter ids are generated
(`List_sCW2T7xBCmN6an=_500_mm`) and values with non-alphanumeric characters get encoding
beyond plain URL-encoding. Carbon posts the parameter map to Onshape's encoder:

```
POST /api/v10/elements/d/{did}/e/{eid}/configurationencodings?versionId={vid}
Body: { "parameters": [ { "parameterId": "…", "parameterValue": "…" } ] }
→ { "encodedId": "…", "queryParam": "configuration=…" }
```

`queryParam` is appended to GETs; `encodedId` goes in POST bodies
(`BTTranslateFormatParams.configuration`). Encoding happens **server-side** in the route
layer — the client only ever holds the human-meaningful parameter map.

### Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Feature shape | A configuration **selector** on the existing import — not "import all configurations as N items" | Carbon's Onshape join key is `readableIdWithRevision`; a configuration does not participate in it. N configurations only become N Carbon items if the customer has Onshape generating a part number per configuration. "Import all" requires solving identity first and is a genuinely larger feature (research §6). |
| Detection source | `GET /elements/…/configuration`, one call on element select | The element listing carries no configuration signal (verified against `BTDocumentElementInfo`'s full property set). No batch form exists, so per-element eager detection would be one call per element against a rate-limited API. |
| Detection failure mode | Any error (403, unsupported element, network) → treat as "no configurations", render today's UI, log server-side | A detection failure must never break the import that works today. Degrading to current behavior is strictly safe: current behavior *is* "default configuration". |
| Where encoding happens | Server-side, in the route layer; client holds the parameter map | One fewer round trip, the encoded string never touches the client, and the map is the thing worth persisting (below). |
| What is persisted | **Both** `configuration` (encoded string) and `configurationParameters` (the `{parameterId: value}` map) in `externalIntegrationMapping.metadata` | The encoded string re-runs API calls; the map re-hydrates the form on reopen with **no decode call**, which keeps `decodeConfiguration` out of v1 entirely. `metadata` is untyped JSONB — no migration. |
| Schema | None | `externalIntegrationMapping.metadata` is `JSONB` (`20260128140000_external-integration-mapping.sql:20`). Adding two keys needs no migration and no type regeneration. |
| Route permission | `requirePermissions(request, {})` on the new config route | Matches every sibling Onshape read route (`.elements.ts`, `.bom.ts`, `.versions.ts`, `.documents.ts` all use `{}`). It reads CAD metadata the user's own Onshape token already grants. The write path (`.sync.ts`) keeps its `{ update: "parts" }`. |
| `includeItemMicroversions` | Stays `false` | The BOM `configuration` param resolves the **top-level** assembly's configuration, which is what determines the child rows. Per-child configuration reporting is display-only and separable (research §7.2). |
| QUANTITY serialization | Send `"{value} {units}"` using `rangeAndDefault.units`; let Onshape's encoder normalize | The encoder takes `parameterValue` as a string and a bare number is unit-ambiguous. Flagged for live probe. |
| Asset-sync configuration | **Phase 2**, separate commit | The webhook path has no user-chosen configuration — it must read `BTRevisionInfo.configuration`. Different trigger, different risk (the configured thumbnail has no version-scoped form), and it is a bug fix rather than a feature. |
| Multi-tenancy (heuristic 1) | N/A — no new table | All reads/writes go through existing `companyId`-scoped rows; `externalIntegrationMapping` insert already carries `companyId`. |
| Service shape (heuristic 2) | N/A — no new service function | Changes live in the `@carbon/ee` Onshape client (a class, existing convention) and route loaders/actions. No `{module}.service.ts` touched. |
| RLS (heuristic 3) | N/A — no new table | `externalIntegrationMapping` policies unchanged. |
| Permission scoping (heuristic 4) | See "Route permission" above | |
| Form pattern (heuristic 5) | N/A — `OnshapeSync` is a fetcher-driven panel, not a `ValidatedForm` | Matches the existing component; introducing RVF here would be a rewrite, and the twin-`ValidatedForm` hydration trap (`.ai/lessons.md`) is a reason not to add one gratuitously. |
| Module layout (heuristic 6) | Unchanged | New route file follows the existing `integrations.onshape.d.$did.v.$vid.e.$eid.*` flat-route naming. |
| Backward compatibility (heuristic 7) | Fully backward compatible | Absent configuration → absent param → Onshape's default → byte-identical to today. Existing `externalIntegrationMapping` rows without the new keys read as "no configuration" and behave exactly as now. |

## Data Model Changes

**None.** No migration, no `pnpm run generate:types`.

`externalIntegrationMapping.metadata` is `JSONB` (nullable, "Provider-specific extras" —
`packages/database/supabase/migrations/20260128140000_external-integration-mapping.sql:20`).
The Onshape row for an item gains two optional keys:

```jsonc
{
  "documentId": "…",
  "versionId": "…",
  "elementId": "…",
  // NEW — both optional; absent on every existing row and on unconfigured elements
  "configuration": "List_sCW2T7xBCmN6an=_500_mm",
  "configurationParameters": { "List_sCW2T7xBCmN6an": "500 mm", "Boolean_xY9": "true" }
}
```

Rows written before this change simply lack both keys, which reads as "default
configuration" — the behavior they were actually imported with.

## API / Service Changes

### `packages/ee/src/onshape/lib/client.ts`

```ts
// Configuration parameter definition for an element. `configurationParameters` is
// EMPTY for an unconfigured element — that emptiness is the detection signal.
export type OnshapeConfigurationParameter =
  | { parameterType: "ENUM";     parameterId: string; parameterName: string;
      defaultValue?: string; options: { option: string; optionName: string }[] }
  | { parameterType: "BOOLEAN";  parameterId: string; parameterName: string; defaultValue?: boolean }
  | { parameterType: "STRING";   parameterId: string; parameterName: string; defaultValue?: string }
  | { parameterType: "QUANTITY"; parameterId: string; parameterName: string;
      quantityType?: string;
      rangeAndDefault?: { minValue?: number; maxValue?: number; defaultValue?: number; units?: string } };

getElementConfiguration(documentId, versionId, elementId):
  Promise<{ configurationParameters: OnshapeConfigurationParameter[] }>
  // GET /api/v10/elements/d/{did}/v/{vid}/e/{eid}/configuration
  // Tolerant reader: the 1.113 OpenAPI declares `parameters`, api-generator declares
  // `configurationParameters`. Read `configurationParameters` and fall back to
  // `parameters` before defaulting to [].

encodeConfiguration(documentId, elementId, parameters, versionId?):
  Promise<{ encodedId: string; queryParam: string }>
  // POST /api/v10/elements/d/{did}/e/{eid}/configurationencodings?versionId={vid}
  // NOTE: the path takes did/eid but NOT wvm/wvmid — the version is a query param.

getBillOfMaterials(documentId, versionId, elementId, options?: { configuration?: string })
  // appends `&configuration=<encoded>` when present; otherwise byte-identical to today
```

Phase 2 adds `configuration?: string` to the existing `OnshapeRevision` interface.

### `apps/erp/app/routes/api+/`

| Route | Method | Change |
|---|---|---|
| `integrations.onshape.d.$did.v.$vid.e.$eid.configuration.ts` | GET (loader) | **New.** Returns `{ data: { parameters }, error: null }`. On any client error returns `{ data: { parameters: [] }, error: null }` and logs — detection failure degrades to "unconfigured", never to a broken panel. `shouldRevalidate: () => false`, matching siblings. |
| `integrations.onshape.d.$did.v.$vid.e.$eid.bom.ts` | GET (loader) | Reads an optional `configuration` search param carrying the **parameter map** as JSON, encodes it server-side, passes the encoded string to `getBillOfMaterials`. Absent/empty/unparseable → no configuration, today's behavior. |
| `integrations.onshape.sync.ts` | POST (action) | Reads `configuration` (the parameter map) from the form data, encodes it, and writes both `configuration` and `configurationParameters` into the `externalIntegrationMapping.metadata` insert. |

### `apps/erp/app/utils/path.ts`

```ts
onShapeElementConfiguration: (documentId, versionId, elementId) =>
  generatePath(`${api}/integrations/onshape/d/${documentId}/v/${versionId}/e/${elementId}/configuration`),
// onShapeBom gains an optional 4th arg appending ?configuration=<encoded JSON map>
```

## UI Changes

### `apps/erp/app/components/OnshapeSync.tsx` (the only call site — `Item/BoMExplorer.tsx:160`)

1. **New fetcher** `configurationFetcher`, loaded in a `useEffect` on
   `[documentId, versionId, elementId, initialized]`, guarded by `!isDisabled` — the same
   shape as the three fetchers above it.
2. **New state** `configurationValues: Record<string, string>`, seeded from the returned
   parameters' defaults in an effect keyed on the fetcher data, and **reset when
   `elementId` changes** — exactly as `elementId` is already reset when `versionId`
   changes. (`.ai/lessons.md`: seeding state once from a changing source goes stale;
   sync it with an effect.)
3. **Conditional block**, rendered inside the existing `disclosure.isOpen` panel below the
   Assembly combobox, **iff `parameters.length > 0`**. One labelled row per parameter,
   matching the existing `flex w-full items-center justify-between gap-2` +
   `w-[180px]` control layout so it reads as a fourth picker rather than a new section.
   No header, no empty state, no "None" placeholder — an unconfigured assembly shows
   nothing at all.
4. **`loadBom`** passes the parameter map; **`saveBom`** appends it to the `FormData`.
5. **`useMount`** restores `configurationParameters` from the mapping row alongside
   `documentId`/`versionId`/`elementId`, so reopening a previously-synced item shows the
   variant it was synced at.
6. `isReadyForSync` is unchanged — configuration is always optional, and defaults are
   always populated, so it can never gate the Sync button.
7. All new strings go through Lingui (`<Trans>` / `t` from `useLingui`), matching the file.

`Number` is used without `formatOptions` (defaults to the quantity kind) and **without a
`step`** — an Onshape quantity parameter has an arbitrary externally-defined range, and
`.claude/rules/numeric-precision.md` permits omitting the prop. No digit or step literals.

## Acceptance Criteria

- [ ] Selecting an assembly with **no** configuration parameters renders the panel exactly
      as it does today — no configuration row, no empty dropdown, no layout shift — and
      Sync produces a BOM identical to the pre-change output for the same element.
- [ ] Selecting an assembly with a `List` configuration renders one `Combobox` labelled
      with the Onshape `parameterName`, whose options are the Onshape `optionName`s, with
      the Onshape `defaultValue` preselected.
- [ ] An assembly mixing `ENUM` + `BOOLEAN` + `QUANTITY` renders a `Combobox`, a `Switch`
      and a `Number` respectively, each prefilled from its Onshape default; the `Number`
      is bounded by `minValue`/`maxValue` and shows the parameter's `units`.
- [ ] Changing a configuration value and pressing Sync returns a BOM whose rows differ
      from the default configuration's BOM for an assembly known to vary by that
      parameter.
- [ ] After Save, the item's `externalIntegrationMapping` row's `metadata` contains both
      `configuration` (a non-empty encoded string) and `configurationParameters` (the
      chosen map).
- [ ] Reopening the panel on that item restores the previously chosen configuration values
      in the controls, with no additional Onshape decode call in the network log.
- [ ] Changing the selected assembly resets the configuration controls to the new
      element's defaults — no value carries over from the previous element.
- [ ] With the configuration route forced to error (simulate a 403 from
      `getElementConfiguration`), the panel renders with no configuration controls and Sync
      still completes successfully against the default configuration.
- [ ] `pnpm exec turbo run typecheck --filter=@carbon/ee --filter=erp` and `pnpm run lint`
      pass; no new `@carbon/checks` conformance findings.

### Phase 2 (separable)

- [ ] `OnshapeRevision` exposes `configuration`, and a revision carrying a non-empty
      `configuration` whose `releaseKey` already resolved to an item **in this same sync
      batch** is skipped with a new `ambiguous-configuration` reason rather than silently
      overwriting the earlier attachment.
- [ ] `onshape-matching.test.ts` covers that skip.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| `getConfiguration` response field name differs from `configurationParameters` (the 1.113 OpenAPI and api-generator disagree) | **High** — this is the detection predicate | Tolerant reader: `configurationParameters ?? parameters ?? []`. Probe against a live tenant as the **first** implementation step, before any UI work. |
| QUANTITY value serialization (`"500 mm"` vs `500` vs `"0.5 m"`) rejected by the encoder | Med | Encoding is server-side and returns a real error, so a bad value surfaces as a visible failure rather than a wrong BOM. Live-probe with a quantity-configured element; fall back to omitting QUANTITY support (ENUM/BOOLEAN/STRING only) if the format resists — recorded as a scope reduction to raise, not to take silently. |
| An extra Onshape call per element selection hits rate limits on a chatty user | Low | One call, only on element change, only when the panel is open and `initialized`. The existing cascade already makes three. `OnshapeApiError` carries `retryAfterSeconds` if needed. |
| A configured BOM's child rows are indistinguishable when the same part appears twice at different configurations | Low (display only) | Out of scope for v1; `includeItemMicroversions` stays `false`. Documented in research §7.2. |
| Users read the selector as "this item IS this configuration" when the part number doesn't vary by configuration | Med | Inherent to the identity constraint (research §6), not fixable in this feature. The persisted `configurationParameters` at least make the imported variant auditable after the fact — today it is unrecoverable. |
| Phase 2's configured thumbnail has no version-scoped endpoint | Med | Deferred with Phase 2. The substitute is `assemblies/…/v/{vid}/…/shadedviews?configuration=…` (returns base64, different shape from the raw PNG `getElementThumbnail` returns), so it needs a second code path, not a parameter. |

## Open Questions

> Resolved autonomously on 2026-08-26 at Brad's explicit instruction ("you don't need to
> grill me"). Every item below is an **assumed decision** pending review at the PR, not a
> human answer. None fall in Ask-First territory (no production-critical schema, no
> auth/RBAC/multi-tenancy change, no public contract change, no new dependency).

- [x] **Should this import one chosen configuration, or all configurations as N items?**
      — **Autonomous:** One chosen configuration. Carbon's `readableIdWithRevision` join
      key has no configuration component; "import all" requires solving identity first and
      is a materially larger feature. Recorded as explicitly out of scope, not deferred
      silently.
- [x] **Where does configuration encoding happen — client or server?**
      — **Autonomous:** Server, in the route layer. One fewer round trip; the encoded
      string never reaches the client; the client holds the human-meaningful map.
- [x] **Do we persist the encoded string, the parameter map, or both?**
      — **Autonomous:** Both. The encoded string re-runs API calls; the map re-hydrates the
      form with no decode call, which keeps `decodeConfiguration` out of v1 entirely.
      `metadata` is untyped JSONB, so this costs nothing.
- [x] **What happens when configuration detection fails?**
      — **Autonomous:** Degrade to "no configurations" and render today's panel. Safe by
      construction: today's behavior already *is* the default configuration. A detection
      failure must never break a working import.
- [x] **Which parameter types do we support in v1?**
      — **Autonomous:** All four (`ENUM`, `BOOLEAN`, `STRING`, `QUANTITY`). Elements mix
      them freely; supporting only `ENUM` would submit silently incomplete configurations.
      `QUANTITY` carries the live-probe risk noted above.
- [x] **Does the new route need a stricter permission than its siblings?**
      — **Autonomous:** No — `requirePermissions(request, {})`, matching all four sibling
      Onshape read routes. It reads CAD metadata the user's own Onshape token already
      grants; the write path keeps `{ update: "parts" }`.
- [x] **Is the asset-sync (webhook) path in scope?**
      — **Autonomous:** No — Phase 2, separate commit. Different trigger (no user-chosen
      configuration; it must read `BTRevisionInfo.configuration`), different risk
      (no version-scoped configured thumbnail), and it is a bug fix rather than a feature.
- [x] **Does `includeItemMicroversions` need to flip to `true`?**
      — **Autonomous:** No. The BOM `configuration` param resolves the top-level assembly,
      which is what determines the child rows. Per-child configuration reporting is
      display-only and separable.

### Deferred to a live probe (not blockers — each has a safe fallback in the design)

These need one authenticated request each against a real configured Onshape document. They
are implementation-order items, not design questions.

1. **`getConfiguration`'s actual response field name.** Do first — it gates the predicate.
2. **QUANTITY `parameterValue` string format** accepted by the encoder.
3. **Whether v10 has a version-scoped configured thumbnail** (`…/v/{vid}/e/{eid}/ac/{cid}/s/{sz}`) — Phase 2 only.

## Changelog

- 2026-08-26: Created. Open questions resolved in autonomous mode (no grill, at Brad's
  instruction); all eight resolutions flagged as assumed decisions for PR review.
