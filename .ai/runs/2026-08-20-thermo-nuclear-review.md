# Thermo-nuclear review — feat/onboarding-templates

> **Remediated 2026-08-20:** T1, D1, Blockers 1–3 and the generated-type housekeeping are
> fixed. Everything else below (Major 4, Minors 5–6, T2–T10, D2–D8) is still open.
> Verification after the fixes: `erp` / `@carbon/database` / `@carbon/jobs` typecheck clean,
> `pnpm db:check:datasets` green on all four, `@carbon/jobs` 313 tests pass, biome clean
> (one pre-existing warning in `datasets/types.ts`).

Scope: the uncommitted working tree (demo CAD models, the `CadModel` model-id fix, the
onboarding scroll fix), reviewed at full depth here. The branch's larger committed
surfaces (`company-template.ts`, the datasets engine) were audited by subagents; their
findings are appended at the end.

Verification run while reviewing: `pnpm db:check:datasets` green on all four,
`pnpm exec turbo run typecheck --filter=erp` clean, `pnpm exec biome check` clean on the
changed files (one pre-existing warning in `datasets/index.ts`).

---

## BLOCKER 1 — `CadModel` grew a second source of truth for a shape the app already models

**FIXED.** `modelPath` + `modelUploadId` collapsed into one `modelUpload?: ModelUpload` prop.

`apps/erp/app/components/CadModel.tsx:41-66`

The fix threads a **new** `modelUploadId` prop alongside the existing `modelPath`, so 14
call sites now carry a two-prop pair that must be kept in sync by hand:

```tsx
modelPath={line?.modelPath ?? null}
modelUploadId={line?.modelId ?? null}
```

But `apps/erp/app/types/index.ts:51` already defines the canonical shape:

```ts
export type ModelUpload = {
  modelId: string | null;
  modelName: string | null;
  modelPath: string | null;
  modelSize: number | null;
  thumbnailPath: string | null;
};
```

…and **8 of the 14 routes already pass exactly that object, on a line directly above the
`<CadModel />` I edited**:

- `part+/$itemId.details.tsx:390` — `modelUpload={partData.partSummary ?? undefined}`
- `quote+/$quoteId.$lineId.details.tsx:445` — `modelUpload={line ?? undefined}`
- `sales-order+/$orderId.$lineId.details.tsx:270` — `modelUpload={line ?? undefined}`
- `sales-rfq+/$rfqId.$lineId.details.tsx:162` — `modelUpload={line ?? undefined}`
- `tool+/$itemId.details.tsx:329`, `job+/$jobId.details.tsx:320`,
  `job+/$jobId.make.$methodId.tsx:194`, `ChangeNotice/AffectedItemDetail.tsx:305`

Verified structurally compatible: `purchaseOrderLines` exposes all five fields
(`modelId, modelName, modelPath, modelSize, modelUploadId, thumbnailPath`), and the
`modelUpload={line}` sites already typecheck against `ModelUpload`.

**Judo move.** Replace *both* props with the canonical one:

```tsx
type CadModelProps = {
  modelUpload?: ModelUpload;   // replaces modelPath + modelUploadId
  ...
};

const { modelPath = null, modelId = null } = modelUpload ?? {};
useOptimizedModel({ modelPath, modelUploadId: modelId, companyId, file });
```

Call sites get **shorter** than before the fix (`<CadModel modelUpload={line} />`), the
path/id desync becomes unrepresentable, and the next person to add a CAD card cannot
reintroduce the phantom-id bug by forgetting the second prop — which is precisely how the
bug arrived.

This is rule 8 (SSOT lives outside the diff). The new prop reads cleanly and is well
commented, which is exactly why it slipped through: a tidy new prop is a prompt to grep
for the canonical one, not a reason to wave it through.

---

## BLOCKER 2 — `getModelByItemId` / `getModelByQuoteLineId` are near-identical, and the fix was pasted into both

**FIXED.** `getModelByQuoteLineId` now resolves the line's item and delegates;
`getModelByItemId` returns one flat `ItemModelUpload` shape.

`apps/erp/app/modules/shared/shared.service.ts:806` and
`apps/erp/app/modules/sales/sales.service.ts:937`

The two functions are ~95% the same body. `getModelByQuoteLineId` resolves
`quoteLine.itemId` and then repeats `getModelByItemId` verbatim. The tell that this is a
real SSOT violation: the `modelId` fix had to be applied **twice, identically**.

```ts
export async function getModelByQuoteLineId(client, quoteLineId) {
  const quoteLine = await client.from("quoteLine").select("itemId").eq("id", quoteLineId).single();
  if (!quoteLine.data) return null;
  return getModelByItemId(client, quoteLine.data.itemId);
}
```

Deletes ~22 lines and one copy of the branch logic.

### 2b — the three-branch union it returns is vestigial

Both functions return a 3-way union (`{itemId,type,modelPath}` | `{itemId,type,modelSize}`
| `{itemId,type,...modelUploadRow}`), which is why `modelId` had to be added to every
branch just so callers could read it without narrowing. That patch treats the symptom.

Checked every consumer (`part/tool/quote/job` make-method routes, quote line details,
purchasing-rfq loader): they read **only** `itemId`, `modelPath`, `modelId`. Nothing reads
`type`, `modelSize`, or any other spread field.

**Judo move.** Return one flat shape — ideally the canonical `ModelUpload` plus `itemId` —
so the union, the spread, and the per-branch `modelId` all disappear together. That also
makes these functions drop straight into Blocker 1's `modelUpload={...}` prop.

---

## BLOCKER 3 — the onboarding scroll fix is a special case in one of five identical pages

**FIXED.** `OnboardingCard` / `OnboardingCardContent` / `onboardingFormClassName` in
`apps/erp/app/components/OnboardingCard.tsx`, applied to all five card-shaped steps;
`plan.tsx` (a wide grid, not a card) caps and scrolls inline with a comment saying why.

`apps/erp/app/routes/onboarding+/company.tsx:133-146`

`max-h-full` + `flex flex-col min-h-0` + `overflow-y-auto` were applied to one page.
But five onboarding steps render the **same** `<Card className="max-w-lg">` inside the
same non-scrolling container (`_layout.tsx:78`,
`flex h-full w-full items-center justify-center p-4`):

- `company.tsx:134` (fixed), `user.tsx:90`, `theme.tsx:125`,
  `industry.tsx:289`, `industry.tsx:360` (two more cards, one rendering an industry list),
  `plan.tsx:151`

Any of those can outgrow a short viewport and become unreachable in exactly the way
company.tsx did — `industry.tsx` most of all. Fixing one page leaves the same latent bug
in four, and the next onboarding step added will inherit the bug rather than the fix.

**Remedy.** Put it in the canonical layer, either:

(a) `_layout.tsx` — make the centering container scroll. Note `items-center` clips
overflow at the top, so this must become `overflow-y-auto` with the child using `m-auto`,
not `items-center`; or

(b) a shared `OnboardingCard` wrapper owning `max-h-full` + the scrolling body, which
preserves the pinned header/footer behaviour and applies it once.

(b) is the better UX and stays DRY; (a) is one line and guarantees nothing is ever
unreachable. Either beats a per-page className.

---

## MAJOR 4 — `componentCount` is a hand-copied duplicate of a fact in the bundled file

**OPEN.**

`packages/database/src/datasets/data/*/assembly.ts`, `datasets/types.ts:AssemblySpec`

`robotics/assembly.ts` hardcodes `componentCount: 163`. The bundled sidecar already says
so:

```
$ python3 -c "import json;print(json.load(open('.../robot-arm.graph.json'))['componentCount'])"
163
```

This is the same failure mode as the documented `nodeId` trap: a re-bake silently
invalidates a hand-maintained literal, and nothing catches it. The branch responds by
documenting the footgun in **three** places (`.claude/rules/onboarding-company-templates.md`,
`.ai/plans/2026-08-20-demo-cad-models.md`, and a memory) instead of making it impossible.

**Judo move.** `pnpm db:check:datasets` already runs pre-commit on any
`packages/database/` change and already loads every dataset. Extend it to validate each
`AssemblySpec` against its bundled `graph.json` — `componentCount` matches, and every
`componentNodeIds` entry exists as a node. Both hand-maintained-fact traps become a caught
error instead of three paragraphs of prose, and `componentCount` can then be dropped from
the spec entirely and read from the graph.

---

## MINOR 5 — `assets.ts` doubled in size to express one wider pattern

**OPEN.**

`packages/database/src/datasets/assets.ts:15-36`

The change went from a single 6-line glob to two globs, a named `Glob` type, a spread
merge, and a comment explaining why the calls "cannot be collapsed into a loop" — a
question nobody asked, because a **single glob with a wider brace pattern** covers both:

```ts
const assets = (import.meta as unknown as Glob).glob("./assets/**/*.{svg,glb,json}", {
  eager: true, query: "?url", import: "default"
});
```

Verified safe: the assets tree contains only `132 svg`, `4 glb`, `4 json`, `1 md` — and
every `.json` is already under `models/`, so the wider pattern matches nothing extra. The
resolver keys on the exact path, so a stray match would be inert anyway.

Keep the one-line note about literals (it is a genuine vite constraint that already bit
this session); drop the rest.

---

## MINOR 6 — the purchasing-RFQ loader works around a view gap instead of closing it

**OPEN** (needs a migration — gated on your call).

`apps/erp/app/routes/x+/purchasing-rfq+/$rfqId.$lineId.details.tsx:54-61`

13 sites read `modelId` off the row; this one adds a gated extra round-trip plus a separate
top-level loader key, because `purchasingRfqLines` is the only line view that exposes
`modelPath` without an id:

```
purchaseOrderLines → modelId, modelName, modelPath, modelSize, modelUploadId, thumbnailPath
purchasingRfqLines → modelPath   (only)
```

The canonical home is the view. Adding `mu.id AS "modelId"` (plus `modelName`/`modelSize`
for parity with its five siblings) in a migration deletes the loader special case and the
extra query, and makes this route identical to the other twelve.

Gated on your call — it needs a migration and a type regen, and per the project rules I
have not touched the database schema.

## HOUSEKEEPING — unrelated generated-type churn is back in the tree

**FIXED** (reverted).

`packages/database/src/types.ts` and `packages/database/supabase/functions/lib/types.ts`
each carry 8 lines of nondeterministic foreign-key **reordering** (e.g. `partner_id_fkey`
`columns: ["id"]` ↔ `["supplierLocationId"]`). No semantic change; a regen artifact
unrelated to this work. I reverted it once already and it has reappeared.

```
git checkout -- packages/database/src/types.ts packages/database/supabase/functions/lib/types.ts
```

## Notes that did NOT become findings (checked, cleared)

- `seedAssembly`'s un-scoped `UPDATE "item" ... WHERE "id" = $2` — verified `item_pkey` is
  `PRIMARY KEY (id)` alone, so this is correct. It is stylistically inconsistent with the
  sibling `trackedEntity` update 40 lines below that does scope by `companyId`, but that is
  a nit, not a tenancy hole.
- File-size rule: no file crossed 1000 lines because of this diff. `sales.service.ts` is
  6109 lines and `shared.service.ts` 1402, but both were already over before these 3-line
  edits. (`sales.service.ts` at 6109 lines is a standing decomposition debt worth its own
  ticket.)
- `.DS_Store` under the new assets tree is covered by `.gitignore:1`.
- The `_templates/` bundling design, the `wipe.ts` table discovery, and backup/restore
  needing no change all hold up — those were the right calls.

---

## Committed branch surfaces — the template job, backup/restore, Settings → Demo Data

Line counts: `company-backup.ts` **1320** (was 1285 — already over 1000 before this branch),
`company-restore.ts` **713**, `company-template.ts` **485** (new), `onboarding.server.ts`
**247**, `demo-data.tsx` **238** (new). Nothing crossed 1000 because of this branch.

### T1 (BUG) — `writeTemplateMarker` silently discards the `templateRunId` it is handed

**FIXED.** `templateRunId` moved last in the merge; `error: null` added to the apply patch.

`company-template.ts:99-104`

```ts
const metadata: TemplateMeta = {
  templateRunId,
  status: "running",
  ...existing?.metadata,   // ← existing.templateRunId wins over the argument
  ...patch
};
```

I verified this against its source: the pattern was copied from `writeRestoreMarker`, which
is safe **only because** `readRestoreMarker` looks the marker up by `restoreRunId`
(`company-restore.ts:288`, `.filter("metadata->>restoreRunId", "eq", restoreRunId)`), so the
two can never differ. `readTemplateMarker` (`company-template.ts:61-66`) looks up by
`companyId` alone, so they can.

Reachable failure: run A fails, leaving `{templateRunId: A, status: "failed", error: X}`.
Run B is allowed past the guard (which only refuses a *non-failed* other run). B's first
write merges to `{templateRunId: A, status: "running", error: X}` — the marker now claims
**A** is running and still carries A's error. B settles on `ready` under A's id, so the
Keep/Revert buttons post the wrong run id; and if B's process dies before its catch, B's
own retry is refused as "already pending".

Fix: `{ status: "running", ...existing?.metadata, ...patch, templateRunId }` — the run id
is the one field the caller owns, so it belongs last. Clear `error: null` alongside
`status: "running"` in the apply patch (`:211`). This is also the one genuinely
load-bearing line in the file with no comment on it, which is how it got in.

### T2 — `companyTemplateRevertFunction` is a transcription of `companyRestoreRevertFunction`, and has already drifted

**OPEN.**

`company-template.ts:369-485` vs `company-restore.ts:616-713` — same 12 steps in the same
order. The copy is already wrong in one place: restore threads a per-file progress
callback, template hardcodes a total.

```ts
// company-template.ts:443
await report({ phase: "files", done: 0, total: 1 });
await restoreAssetsFromBackup(client, { files: snapshot.manifest.storage, … });  // no cb
```
```ts
// company-restore.ts:670-684
const fileCount = snapshot.manifest.storage?.filter((f) => f.included).length ?? 0;
await report({ phase: "files", done: 0, total: fileCount });
await restoreAssetsFromBackup(client, {…}, (done, total) => report({ phase: "files", done, total }));
```

Fix: one exported `revertToSnapshot(client, db, { companyId, snapshotPath, includeGroup,
onProgress })` in `company-restore.ts`. Both Inngest functions collapse to: read marker →
call it → clear marker → catch. Same treatment for the two finalize functions
(`company-template.ts:326-366` / `company-restore.ts:583-613`), which differ only by the
settled-status guard.

### T3 — marker read/upsert/clear/report is now written three times in one directory

**OPEN.**

`company-template.ts:57-156`, `company-restore.ts:278-366`, `company-export.ts:243-288`.
All three do the same `select id, metadata → update-or-insert` on
`externalIntegrationMapping`, and each redeclares
`type ServiceRole = ReturnType<typeof getCarbonServiceRole>`. The branch even extracted
`JobProgress` into `company-backup.ts:351` but left a fourth copy behind at
`company-export.ts:241` (`type ExportProgress = { phase; done; total }`).

Fix: one `createMarkerStore<Meta>(integration, { entityType, key })` in `company-backup.ts`
returning `{ read, write, clear, report }` — `report` is already `throttleProgress ∘ write`
in all three. Each file then keeps only its `Meta` type.

### T4 — `snapshot?: boolean` is a two-mode fork with nothing on the false side

**OPEN.** Highest-leverage remaining cleanup.

`packages/lib/src/events.ts:200-206` documents a "legacy fire-and-forget" path, but both
producers hardcode `snapshot: true` (`demoData.server.ts:23`, `onboarding.server.ts:116`)
and grep finds no third. It forks the job at `:275` (`wipeFirst: takeSnapshot`) and
`:298-311` (ready-vs-clear), plus a JSDoc paragraph at `:80-84` describing a path nothing
takes. Worse, it is a live footgun: `snapshot: false` also turns off `wipeFirst`, so a
template applied that way would stack demo rows on top of real ones.

Fix: delete the flag; make snapshot + `wipeFirst: true` + terminal `ready` unconditional.

### T5 — two functions named `startCompanyTemplate` firing the same event

**OPEN.**

`onboarding.server.ts:104-122` and `modules/settings/demoData.server.ts:14-26` both mint a
`nanoid()` and trigger the same event with the same payload; the onboarding copy adds only
a null-guard and a rethrow. Have onboarding import the settings one. That is also the
natural home for the guard duplicated between `demo-data.tsx:84-91` and the job at
`company-template.ts:196-205`.

### T6 — `demo-data.tsx` fabricates an invalid run object to drive the spinner

**OPEN.**

`demo-data.tsx:175-193` builds a `CompanyTemplateRun` with `templateRunId: ""` and passes
it to `TemplateReviewRow`, whose `submit()` posts `run.templateRunId`. The only thing
stopping an empty-id POST is that the buttons happen to be disabled in that state. With
`resolvedRunIds`, `pendingApplyKey`, and the row's own `revertRequestedAt`/`mountedAt`,
that is four ad-hoc optimistic-state mechanisms for one card.

Fix: a real discriminated union —
`run: CompanyTemplateRun | { status: "enqueued"; datasetKey: string }`. The `"enqueued"`
arm has no id, so the bad POST becomes unrepresentable rather than merely unreachable, and
the `startedAt: null → mountedAt` special case (`TemplateReviewRow.tsx:75-77`) disappears.

### T7 — `resolveRestoreScope` called twice, half-discarded each time

**OPEN.**

```ts
const { includeGroup } = await resolveRestoreScope(client, companyId);   // :238
const { targetGroupId } = await resolveRestoreScope(client, companyId);  // :433
```

Line 433 pays for a `count: "exact"` scan on `company` purely to throw `includeGroup` away
— which the marker already carries (`:439`). The sibling revert calls the cheap
`getCompanyGroupId` for exactly this (`company-restore.ts:660`). Swap it; T2's shared
helper makes it moot.

### T8 — the marker JSON shape is declared in three unrelated places

**OPEN.**

`TemplateMeta` (`company-template.ts:37-49`) is the writer; `backups.service.ts:299-307`
re-declares it as an inline `as {…}` cast; `CompanyTemplateRun` (`backups.service.ts:261-272`)
is a third. `{ phase; done; total }` appears literally at `backups.service.ts:218, 247,
268, 305`. The justifying comment (`:281-283`) says the app must not pull job internals
into its bundle — but `import type` is erased at compile time and carries no runtime edge.

Fix: move `TemplateMeta`/`JobProgress` to `packages/lib/src/events.ts`, next to the event
they travel on, and import from both sides.

### T9 — two comments assert things the code no longer does

**OPEN.**

```ts
// onboarding.server.ts:188
// Re-entry still honours the template — the job refuses if items already exist.
```
That `item`-rows guard is gone; the job now refuses on a pending marker for a *different*
run, and on re-entry with no marker it re-applies via `wipeFirst`. The comment describes
the opposite behaviour.

```ts
// company-restore.ts:238
/** Exported: also used by `company-template.ts` when reverting a demo template. */
export async function getCompanyGroupId(
```
`company-template.ts:21` imports only `{ resolveRestoreScope, wipeAndLoad }`. Fixing T7
gives the comment the consumer it claims.

### T10 — comment quality: good, with two exceptions

**OPEN.**

The dense "why" comments in `company-template.ts` mostly earn their place — `:193-195`
(a pending keep/revert owns the only snapshot), `:224-228`, `:234-236` (snapshot
idempotency), `:264-266` all encode reasoning not recoverable from the code. Two are pure
restatement, both inherited from the T2 copy: `:409` ("Flag the run as reverting so the
page can show it is in flight") and `:298-300`. Delete those two. (The T1 spread-order
comment asked for here has been added.)

### Well-structured — no finding

`throttleProgress` (`company-backup.ts:351-379`) is the right judo: it *deleted* the
hand-rolled throttle in `company-restore.ts` instead of adding a second one.
`PER_COMPANY_CONCURRENCY` (`company-template.ts:27-31`) is defined once and shared by all
three functions, where `company-restore.ts` still repeats its key string three times
(`:380, :590, :623`) — the new file is the better example. `readIntegrationMarker`
(`backups.service.ts:189`) correctly unified the app-side readers. `applyDataset`'s
`wipeFirst` replacing the old `beforeTiers` callback is a real simplification, not a
bolted-on flag.

## Datasets engine

Scale: 40,431 lines added across 207 files under `datasets/`, but ~34,000 of that is
`data/<key>/` literals. The **engine** is 5,708 lines. Only `types.ts` exceeds 500 (952);
nothing over 1000. On the whole the engine is well-factored — `sql.ts`, `dates.ts`,
`verify.ts` and `helpers/job-method.ts` are genuinely good.

### D1 (BUG) — an earlier commit on this branch fixed the hardcoded carrier in tiers 5 and 12 but missed tier 4

**FIXED.** Tier 4 now reads `ctx.dataset.foundation.defaultShippingMethod`.

`04-sales.ts:30-34`

```ts
// 04-sales.ts — industry-agnostic shared code, naming one industry's carrier
const shippingMethodId = need(ctx.refs.shippingMethods, "UPS Ground", "shipping method");
```
```ts
// 05-purchasing.ts:15 — the same lookup, done correctly
const shippingMethodId = need(ctx.refs.shippingMethods, ctx.dataset.foundation.defaultShippingMethod);
```

I checked the history: commit `36278642a` *"read the shipping method from the dataset, not
a hardcoded UPS Ground"* touched only `05-purchasing.ts` and `12-planning.ts`. Tier 4 was
missed. `FoundationData.defaultShippingMethod` exists for exactly this and `types.ts:176`
documents it. All four datasets happen to set it to `"UPS Ground"` today, so it is latent
— but a fifth dataset shipping FedEx throws in tier 4 with an error naming a carrier that
appears nowhere in its data. One-line fix; finishes a fix already started.

### D2 — `SeedRefs` is 16 typed bags plus 18 *untyped* string namespaces, with four miss policies

**OPEN.** Highest-leverage remaining cleanup alongside T4.

`types.ts:801-818`, `sql.ts:180-186`

`refs.makeMethods` is entirely dead (0 writes, 0 reads); `refs.shifts` is write-only
(`01-foundation.ts:18`). Meanwhile the real namespaces live as untyped string prefixes —
`documents` carries 6 (`job: opp: po: so: soline: sq:`), `misc` carries 12 — so
``misc[`cloc:${c}`]`` is indistinguishable from a typo at compile time, which is precisely
what the typed bags were meant to prevent.

Four lookup policies coexist, three of them inside `12-planning.ts` alone:

- `need(ctx.refs.customers, spec.customer)` → throw (`04-sales.ts:60`)
- `refs.customers[order.customer]!` → non-null assert (`12-planning.ts:83, :112`)
- `refs.locations.Plant ?? locationId` → silent degrade (6 tiers)
- `if (!item) { ctx.log("skip …"); continue; }` → silent skip (`12-planning.ts:41, 61, 173`)

`need`'s `what` label is passed inconsistently too, so half the error messages don't say
what was missing.

**Restructure.** One accessor keyed by a `RefKind` union — the kind *is* the label, so
`need`'s third argument disappears:

```ts
class Refs {
  set(kind: RefKind, key: string, id: string): void;
  get(kind: RefKind, key: string): string;          // throws: `Seed: missing process "Milling"`
  find(kind: RefKind, key: string): string | null;  // the ONLY sanctioned soft path
}
```

Then delete `need()`, drop `makeMethods`/`shifts`, and delete the three skip-and-log blocks
— they hide exactly the dataset bugs the drift check exists to catch.

### D3 — the sales-order header is written three times, ~120 lines

**OPEN.**

`04-sales.ts:177-232`, `04-sales.ts:322-358`, `12-planning.ts:88-127` all do the identical
five steps (`nextSequence` → `salesOrder` (same 8 columns) → `salesOrderPayment` →
`salesOrderShipment` (same 6 columns) → lines).

Extract `createSalesOrder(ctx, args)` into `helpers/sales-order.ts`; the three call sites
collapse to ~6 lines each. Purchasing has the same shape twice
(`05-purchasing.ts:31-49` and `:280-302`) — a sibling `createPurchaseOrder` removes ~40 more.

### D4 — `runTier4` is 342 lines, 252 of them one nested closure with five phases of shared mutable state

**OPEN.**

`04-sales.ts:58-310`. `insertOpportunity` inlines rfq → quote → order → shipment → invoice
and threads them through mutable locals (`let orderId`, `let orderReadableId`,
`orderLineIdByItem`, `let shipmentId`), so every downstream block re-checks them
(`if (!orderId || !orderReadableId) throw`, `shipmentId ?? undefined`). The repeated
null-guards are the missing model announcing itself — and this closure is *why* D3 exists:
it is un-reusable, so the status-order path at `:317` copy-pasted its body.

Make the accumulated state an explicit `OppState` and split into five top-level
`seedRfq/seedQuote/seedOrder/seedShipment/seedInvoice` functions; `runTier4` becomes a
~30-line driver and `seedOrder` calls D3's helper.

### D5 — `ctx.anchor` is threaded through 32 call sites, and the optional-date ternary repeats 7×

**OPEN.**

```ts
expirationDate:
  spec.rfq.expirationOffset === undefined
    ? undefined
    : resolveDate(ctx.anchor, spec.rfq.expirationOffset),
```

`ctx.anchor` is the only anchor any of them will ever pass. Bind it once in `buildCtx` and
expose `ctx.date(offset)` / `ctx.dateOrNull(offset)` / `ctx.timestamp(offset, timeOfDay)`.
Removes ~35 lines and the "did I pass the right anchor?" question. Keep `anchor` on `Ctx`
for `previousMonthEnd` / `weekRangesFrom`.

### D6 — `wipe.ts` re-implements schema introspection + topological sort that already exist in `company-backup.ts`

**OPEN.**

`wipe.ts:67-158` vs `company-backup.ts:520-608, :818-856`. Second implementations of four
primitives: the `information_schema` company-scoped-table query, the
`pg_constraint`/`unnest(conkey)` FK query, a hand-rolled Kahn sort, and identifier quoting.

The rule doc correctly explains why the two wipes' *scope* must differ, and that is not in
question — but the *mechanism* is identical and now drifts independently. The backup
version already handles cases this one doesn't (transitive scope for tables with no
`companyId` column; deterministic cycle-breaking instead of throwing).

Dependency direction forbids `@carbon/database` importing `@carbon/jobs`, so move the
primitives **down**, not sideways: a new `packages/database/src/schema-graph.ts` exporting
`getTableGraph` + `topologicalSort`, which `company-backup.ts` re-exports. `wipe.ts` keeps
only what is genuinely its own — `PRESERVED_TABLES`, `nullNullableReferences`,
`assertWipeClean`. ~90 lines deleted and one graph implementation instead of two.

### D7 — `types.ts` (952 lines) is three files, and its name is wrong

**OPEN.**

`:1-797` specs, `:799-858` `Ctx`/`SeedRefs`/`Tier`, `:860-952` three functions that open a
connection and run SQL:

```ts
import { maybeOne, one } from "./sql.ts";   // types.ts:5 — a *value* import
export async function buildCtx(client: PoolClient, ...) {
  const company = await one<...>(client, `SELECT id, "companyGroupId" FROM company WHERE id = $1`, ...);
```

`sql.ts:3` imports `Ctx` back — type-only, so no runtime cycle, but the two most central
modules each name the other, and every dataset author who opens `types.ts` to add a `*Spec`
scrolls past `buildCtx`'s preflight SQL.

Split into `contract.ts` (the ~780 lines authors actually read), `context.ts`
(`Ctx`/`SeedRefs`/`Tier`/`buildCtx`, and D2's `Refs`), with `types.ts` left as a barrel so
no import path changes. Zero logic change.

### D8 — three duplicated micro-lookups the tiers each re-solved locally

**OPEN.**

**(a)** "root operation(s) of a job" — the same 6-line SQL three times
(`06-production.ts:159-173`, `:224-234`, `07-quality.ts:50-61`), differing only by `LIMIT`.
→ `rootJobOperations(ctx, jobId, limit)` in `helpers/job-method.ts`, which already owns the
`parentMaterialId IS NULL` concept.

**(b)** `02-items.ts` re-declares `need()` twice — `needItem` (`:56-60`) is literally
`need(ctx.refs.items, id, "item")`. Delete it; move `needMM`'s extra null check to
`helpers/items.ts`.

**(c)** `const plantId = ctx.refs.locations.Plant ?? locationId;` in six tiers, two
spellings — and it is a silent-degrade path (D2) even though tier 1 *always* creates the
plant, so a miss is a bug. Make it a `Ctx` getter that throws.

### Minor

`tiers/10-ops.ts` is a 7-line placeholder logging `"ops/misc — nothing to seed yet"`; it
costs a `TIERS` entry, a progress step, and a misleading log line. Drop it until it has
content. Two restate-only comments: `01-foundation.ts:142` and `helpers/items.ts:42`.

### Genuinely good — don't touch

`sql.ts`'s `columnsOf` memoization, the `insertReturning` "ON CONFLICT DO NOTHING trap"
guard (`:119-137`), and the `ensureSequences`-before-`resetSequences` ordering comment are
all earned. The `information_schema`-driven INSERT builder is **not** a duplicate —
`company-backup.ts` introspects for export/restore, not INSERT construction. `dates.ts` is
correctly built on `@internationalized/date` and is not a duplicate of `@carbon/utils`
`datetime.*` (offsets from an anchor vs "now" in a tz). `nextSequence` calls the
`get_next_sequence` **Postgres function** rather than reimplementing the TS helper —
correct, since the TS one needs a Kysely transaction the seeder doesn't have. `verify.ts`'s
`finally { ROLLBACK }` is exactly right. `12-planning.ts:138-143`'s
`pg_advisory_xact_lock` comment is the single best comment in the diff.

---

## Verdict

Not approvable as-is, but nothing here is a rewrite — the architecture is sound and several
pieces (`throttleProgress`, `wipeFirst`, `sql.ts`, `dates.ts`) are exemplary.

Two real bugs to fix before merge: **T1** (marker run-id shadowing) and **D1** (tier 4's
missed carrier fix). Three structural blockers on the uncommitted work: **1** (`CadModel`
duplicating the canonical `ModelUpload` type), **2** (the twin model getters), **3** (the
one-page onboarding scroll fix). **T4** (dead `snapshot` flag) and **D2** (`SeedRefs`) are
the highest-leverage cleanups — each deletes a whole category of branching.

*(All five of the above are now fixed — see the header. T4 and D2 remain the next-best
work.)*
