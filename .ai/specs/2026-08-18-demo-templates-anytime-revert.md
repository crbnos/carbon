# Demo Templates, Anytime — apply from Settings, revert from a snapshot

**Status:** Draft — awaiting review
**Author:** aashu
**Date:** 2026-08-18
**Extends:** [`.ai/specs/implemented/2026-08-13-onboarding-company-templates.md`](implemented/2026-08-13-onboarding-company-templates.md)

## TLDR

Demo templates stop being an onboarding-only, one-shot decision. A new
**Settings → Demo Data** page lets an internal user apply any of the four datasets to
an existing company at any time, and undo it. Safety comes from reversibility, not
from refusal: the job snapshots the company first, wipes, applies, and then parks on a
Keep/Revert review row — exactly the story `Settings → Backups` already tells for
restore.

The one non-obvious constraint: **the two wipes in this repo preserve opposite things**,
and applying a template needs the dev-seed one, not the restore one.

## Problem Statement

Today a demo template can only be applied during onboarding, on a company that has no
`item` rows, and the decision is permanent.

- `company-template.ts:142-169` refuses outright if the company already has items. That
  guard is correct for its purpose (a retry must not duplicate the catalog) but it also
  means any company that has been used at all can never see sample data.
- There is no way to remove a template once applied. A prospect who wants to see the
  satellite story and then start clean has to create a second company.
- Sales and support cannot load a demo story into an existing company for a call.
- `company-template` is the one marker integration with **no ERP UI reading it**
  (`company-restore` and `company-export` both have one). A failed template application
  is currently invisible in the product.

The machinery to fix this already exists and is already documented as a reuse point.
`buildCompanyBackup` carries the comment "Exported so the same logic backs the export
job, snapshots and onboarding templates" (`company-export.ts:37-43`), and `applyDataset`
already exposes a hook for running a wipe inside the tiers' transaction
(`datasets/index.ts:63`). Nothing here needs inventing; it needs wiring.

## Goals

- Apply any registered dataset to an existing company from Settings, at any time.
- Undo it, returning the company to exactly its pre-apply state.
- Make an in-flight or failed template application visible in the product.
- Reuse the Backups page's tested progress/review components rather than growing a
  second set.

## Non-Goals

- **CAD / 3D template assets.** `TEMPLATE_ASSET_PREFIX` and the `company-templates`
  bucket stay dormant. Part artwork remains the bundled SVGs
  (`packages/database/src/datasets/assets.ts`). Out of scope, unchanged by this work.
- **A bare "reset my company" with no template.** The wipe is only ever a step inside an
  apply. Shipping a standalone destructive wipe is a separate product decision.
- **Public availability.** The page is internal/local-dev gated for v1 (see Design
  Decisions).
- **Snapshot auto-expiry / retention job.** A snapshot lives until the user resolves the
  review row. No scheduled cleanup is added.
- **Changing what the datasets contain.** No tier or dataset edits.

## Research

**N/A — internal mechanical change.** There is no external precedent to consult: the
design is entirely constrained by two existing in-repo subsystems (the dataset tier
engine and the backup/restore engine), and the correct shape falls out of their
documented reuse seams. The "research" here was a codebase audit, recorded inline with
file:line citations throughout this document.

## The constraint that shapes everything: two wipes

| | `wipeCompanyBusinessData` (`datasets/wipe.ts:184`) | `selectWipeableTables` + `wipeScopedData` (`company-backup.ts:1046,1105`) |
|---|---|---|
| Used by | dev seed CLI | restore / revert |
| Scope columns | `companyId` only | `companyId` **and** `companyGroupId` |
| Chart of accounts, `unitOfMeasure`, `sequence`, `paymentTerm`, `location`, `employeeType` | **preserved** | **deleted** |
| MRP transients (`demandActual`, `supplyForecast`, …) | deleted | never touched (`CATALOG_EXCLUDED_TABLES`) |
| Assumes afterwards | tiers will run against surviving config | a backup will reload everything |

The tiers **require** the config to exist — `buildCtx` resolves the chart of accounts,
unit of measure `EA` and the sequences before tier 1 runs (`datasets/types.ts:104-136`),
and the 2026-08-13 spec records that the template branch deliberately needs the *full*
clean seed rather than an identity-only one.

So:

- **Apply** = dev-seed wipe (preserve config) → tiers.
- **Revert** = restore wipe (tabula rasa) → load snapshot.

The asymmetry is correct. Each wipe is paired with the thing that repopulates after it.
Using the restore wipe for apply would leave a company with no chart of accounts for the
tiers to post against; using the dev wipe for revert would leave stale config the
snapshot then duplicates.

## Design

### Flow

```
User picks a dataset on Settings → Demo Data
  → action triggers carbon/company-template { snapshot: true }
  → job:  phase "snapshot"  buildCompanyBackup(includeStorage: "all") → snapshotPath
          phase "wipe"   ┐ ONE transaction, inside applyDataset
          phase "apply"  ┘ wipeFirst → tiers 1..12
          marker → status "ready", snapshotPath retained
  → page shows a review row: [Keep] [Revert]

Keep   → carbon/company-template-finalize → removeStoragePrefix(snapshot) → clear marker
Revert → carbon/company-template-revert   → wipeAndLoad(snapshot) → drop snapshot → clear marker
```

Apply is **all-or-nothing**: the wipe runs inside the tiers' existing transaction, so a
tier that throws rolls the wipe back too and the company is untouched. This is a
stronger guarantee than restore has today, and it comes for free from `applyDataset`
already opening the transaction itself (`datasets/index.ts:74-97`).

### `applyDataset` gains `wipeFirst`, and `beforeTiers` goes away

`beforeTiers` exists for exactly one caller and one purpose — letting the dev CLI run
its wipe inside the tiers' transaction (`datasets/index.ts:63`, used at
`seed-dev.ts:65-72`). Rather than export the destructive `wipeCompanyBusinessData` as
new public surface, replace the generic hook with the specific option:

```typescript
// packages/database/src/datasets/index.ts
export async function applyDataset(
  client: PoolClient,
  opts: {
    companyId: string;
    userId: string;
    dataset: Dataset;
    timeZone: string;
    tiers?: number[] | null;
    log?: (message: string) => void;
    /** Clear the company's business data first, preserving bootstrap config. */
    wipeFirst?: boolean;
  }
): Promise<void>;
```

`seed-dev.ts` migrates to `wipeFirst: true` and `beforeTiers` is deleted. Net effect on
the public surface: one boolean replaces one arbitrary-callback escape hatch, and the
wipe stays un-exported and un-callable on its own.

`packages/database/AGENTS.md` currently states that `wipe.ts` is "dev-only and never
reachable from the shared engine or from onboarding" — that becomes false and must be
corrected in the same change.

### Job changes — `company-template.ts`

The event gains one field:

```typescript
// packages/lib/src/events.ts
"carbon/company-template": {
  data: {
    companyId: string;
    userId: string;
    datasetKey: string;
    templateRunId: string;
    /** Snapshot first and park on Keep/Revert. False = legacy fire-and-forget. */
    snapshot?: boolean;
  };
};
```

Two new events, mirroring restore's finalize/revert pair:

```typescript
"carbon/company-template-finalize": { data: { companyId: string; templateRunId: string } };
"carbon/company-template-revert":   { data: { companyId: string; templateRunId: string; userId: string } };
```

`TemplateMeta` (`company-template.ts:15-21`) extends to:

```typescript
type TemplateStatus = "running" | "ready" | "failed" | "reverting";
type TemplateMeta = {
  templateRunId: string;
  status: TemplateStatus;
  datasetKey?: string;
  startedAt?: string;
  error?: string | null;
  snapshotPath?: string;
  progress?: { phase: string; done: number; total: number };
};
```

**The `item`-count guard is replaced, not kept.** Its job was retry idempotency, and
`wipeFirst` provides that structurally — a second attempt wipes the first attempt's rows
before re-seeding. What must be preserved is the snapshot: on retry the job **reuses**
`marker.metadata.snapshotPath` rather than taking a fresh one, or it would snapshot the
already-seeded state and destroy the user's real data. This is precisely the pattern at
`company-restore.ts:473-490` and is copied from it.

When `snapshot` is false (nothing triggers this after the onboarding decision below, but
the field is optional and the legacy path must not silently change meaning), behaviour is
today's: no snapshot, marker cleared on success.

**Success no longer clears the marker.** With `snapshot: true` the marker settles on
`ready` and holds `snapshotPath`; it is cleared by finalize or revert. This is what makes
the review row appear and what blocks a second apply.

Concurrency stays as-is (`[{ limit: 2 }, { key: "event.data.companyId", limit: 1 }]`,
`company-template.ts:113-122`); the finalize and revert functions take the same
per-company key.

### Revert reuses the restore loader

`wipeAndLoad` is module-private in `company-restore.ts:47`. Export it and call it from
`companyTemplateRevertFunction` with `includeGroup` computed the same way restore does
(`groupCompanyCount === 1`). The snapshot is a genuine `CompanyBackup`, so nothing else
about the load path changes, including the referential-closure preflight and the
`{companyId}/` write guard in `restoreAssetsFromBackup`.

Rejected alternative: have the template job write a `company-restore` marker so the
existing revert function picks it up. Two markers describing one operation is a state
machine nobody can reason about, and the restore review row would then appear on the
Backups page for a demo-template action.

### Onboarding also snapshots

`startCompanyTemplate` (`onboarding.server.ts:100-117`) passes `snapshot: true`. The
company is nearly empty at that point, so the snapshot is small and fast, and it means a
template chosen at signup is revertible from Settings on day two. One code path, one
behaviour to explain.

Consequence to accept deliberately: a newly onboarded company arrives with a pending
review row on the Demo Data page ("Demo data applied — Keep or Revert"). That is honest —
the state genuinely is "applied, not yet confirmed" — and resolving it is one click.

### UI

New page `apps/erp/app/routes/x+/settings+/demo-data.tsx`, in the Settings **System**
group beside Backups.

- **Template cards** — all four datasets by name (`satellite`, `robotics`, `precision`,
  `motor`), read from `datasetKeys`/`DATASETS`. Not filtered by the company's industry:
  making someone edit their company profile to reach a different sample dataset is
  friction with no safety benefit.
- **Apply** posts `intent=apply` with `datasetKey`. Following the Backups precedent
  (`BackupChoices.tsx:71-74`), there is **no** typed-confirmation modal — the safety
  story is reversibility, carried by card copy: *"Replace this company's data with a demo
  dataset — snapshotted first, so you can revert."*
- **Progress** reuses `JobProgressModal` (`BackupProgressModal.tsx`), adding phase keys
  `snapshot | wipe | apply` to `PHASE_ORDER`/`PHASE_LABELS` (revert reuses the existing
  `wipe | load | files`).
- **Review row** reuses the `RestoreReviewRow` shape: `[Keep]` / `[Revert]` on `ready`,
  `[Dismiss]` on `failed`, with the same optimistic `resolvedRunIds` hiding trick
  (`backups.tsx:346-351`) so the row does not linger while the async finalize lands.
- **Blocking** — while a marker is `running`, `ready` or `reverting`, the apply buttons
  are disabled and the action refuses server-side with *"Finish your current demo data
  change — keep or revert it — first."* (mirrors `backups.tsx:179-185`).
- **Polling** — 500 ms `setInterval` + `useFetcher.load` against a new status endpoint
  while a run is active; 2.5 s `useRevalidator` otherwise. Same idiom as
  `BackupProgressModal.tsx:184-216`.

### Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Where the option lives | New `Settings → Demo Data` page in the System group | Backups is about your data; Demo Data is about sample data. Folding it into `backups.tsx` would bury a demo feature in a page named Backups. |
| Apply semantics on a non-empty company | Snapshot → wipe → apply → Keep/Revert | Mirrors restore. Reversibility is the safety story the codebase already relies on; refusing would make "apply anytime" untrue for any company that has been used. |
| Which wipe | Dev-seed wipe (`datasets/wipe.ts`) for apply; restore wipe for revert | The tiers require bootstrap config to survive; the snapshot reload requires it not to. See "two wipes" above. |
| How the wipe is reached | New `wipeFirst` option on `applyDataset`, replacing `beforeTiers` | Keeps `wipeCompanyBusinessData` un-exported. A boolean is a narrower public contract than an arbitrary callback that runs inside a transaction. |
| Atomicity of apply | Wipe inside the tiers' transaction | `applyDataset` already owns the transaction. A failed tier rolls the wipe back, so a half-wiped company is not reachable. |
| Revert mechanism | Export `wipeAndLoad` from `company-restore.ts` and call it | The snapshot is a real `CompanyBackup`; reusing the tested loader keeps the closure preflight and cross-tenant write guard. |
| Revert window | Until Keep is clicked; blocks re-apply while pending | Matches restore. Forces an explicit decision and bounds storage to one snapshot per company. |
| Onboarding | Also snapshots (`snapshot: true`) | Tiny on a fresh company, and it makes a signup-time choice revertible. One path, not two. |
| Template choice in Settings | All four datasets, by name | It is a demo tool; industry filtering would strand companies with no industry or an industry with no dataset. |
| Access gate | `canAccessBackups` (internal email or local dev) | Same destructive blast radius and the same unhardened multi-tenant caveats as backups. Prove it internally, then drop the gate the way backups plans to. |
| Confirmation UX | No typed confirmation | Consistent with restore, which is equally destructive and equally reversible. Adding friction here but not there would be arbitrary. |
| Marker | Extend the existing `company-template` marker | It already exists, already has a unique-per-company index, and is currently the one marker with no UI. |
| `period` duplication on re-apply | No change needed | Tier 12 already read-then-inserts and its comment at `12-planning.ts:133` records that the wipe cannot see `period`. Verified, not assumed. |

## Data Model Changes

**None.** No migration. The feature reuses the existing `externalIntegrationMapping`
marker row (`integration = "company-template"`, `entityType = "template"`,
`entityId = companyId`) and only widens the JSON in its `metadata` column.

Snapshots are storage objects in the existing per-company bucket under the same
`_pre-restore-`-style naming the restore snapshot uses; no new bucket.

## API / Service Changes

**`packages/database`**
- `src/datasets/index.ts` — `applyDataset` gains `wipeFirst?: boolean`; `beforeTiers`
  removed.
- `src/seed-dev.ts` — migrates from `beforeTiers` to `wipeFirst: true`.
- `AGENTS.md` — correct the claim that `wipe.ts` is unreachable from anything but dev.

**`packages/lib`**
- `src/events.ts` — `snapshot?: boolean` on `carbon/company-template`; two new events
  `carbon/company-template-finalize`, `carbon/company-template-revert`.
- `src/trigger.ts` — task-id entries for the two new events.

**`packages/jobs`**
- `tasks/company-template.ts` — snapshot step, phase progress, extended `TemplateMeta`,
  `item`-guard replaced by snapshot reuse, marker settles on `ready`.
- `tasks/company-template.ts` (new exports) — `companyTemplateFinalizeFunction`,
  `companyTemplateRevertFunction`; registered in `tasks/index.ts` and `inngest/index.ts`.
- `tasks/company-restore.ts` — export `wipeAndLoad`.

**`apps/erp`**
- `app/modules/settings/demoData.service.ts` (new) — `getCompanyTemplateRun(client, companyId)`.
- `app/modules/settings/demoData.server.ts` (new) — `startCompanyTemplate`,
  `finalizeCompanyTemplate`, `revertCompanyTemplate` trigger wrappers.
- `app/routes/x+/settings+/demo-data.tsx` (new) — loader + action (`apply` / `keep` /
  `revert` / `dismiss`), gated by `{ update: "settings" }` + `requireBackupAccess(email)`.
- `app/routes/api+/settings.demo-data-status.$templateRunId.ts` (new) — poll endpoint,
  `companyId` from `requirePermissions`, 404 (not 403) when the gate fails.
- `app/utils/path.ts` — `demoData: \`${x}/settings/demo-data\``.
- `app/modules/settings/ui/useSettingsSubmodules.tsx` — System-group entry, added to
  `localOrInternalRoutes`.
- `app/modules/settings/ui/DemoData/` (new) — `TemplateCards.tsx`, `TemplateReviewRow.tsx`.
- `app/services/onboarding.server.ts` — `startCompanyTemplate` passes `snapshot: true`.
- `app/modules/settings/ui/Backups/BackupProgressModal.tsx` — `snapshot | wipe | apply`
  phase labels.

**`.claude/rules`**
- `onboarding-company-templates.md` — the new Settings entry point, the snapshot/revert
  lifecycle, and the two-wipes distinction.
- `company-backup-restore.md` — `wipeAndLoad` is now exported and has a second caller.
  Also fix the pre-existing stale line claiming `STORAGE_PATH_COLUMNS` contains
  `modelPath` (the code at `company-backup.ts:54` has only `thumbnailPath`) and the stale
  "`satellite` is the only one today" line (`DATASETS` has four).

## UI Changes

One new page, one new nav entry, two new components, one modified phase map. No changes
to any existing screen's behaviour. The Backups page is untouched.

## Acceptance Criteria

- [ ] A company with existing sales orders, jobs and items applies the `robotics`
      template from Settings → Demo Data; afterwards the item list contains only robotics
      catalog parts and none of the pre-existing ones.
- [ ] Clicking Revert on that company restores the exact pre-apply state: `item`,
      `salesOrder`, `job` and `nonConformance` row counts match the pre-apply counts, and
      a spot-checked sales order has its original `salesOrderId` and line quantities.
- [ ] Clicking Keep removes the snapshot folder from the per-company bucket and clears
      the marker; the review row disappears and the apply buttons re-enable.
- [ ] While a run is `running` or `ready`, submitting a second apply returns the flash
      "Finish your current demo data change — keep or revert it — first." and no second
      job is enqueued.
- [ ] Applying a template to a company whose chart of accounts was customised leaves that
      chart of accounts intact (the dev wipe preserves `account`-adjacent config), and the
      seeded journal entries post against it without error.
- [ ] A tier forced to throw mid-apply leaves the company byte-identical to its pre-apply
      state (transaction rollback), the marker reads `failed` with the error text, and the
      snapshot is still present so the user is never stranded.
- [ ] Re-running the same `templateRunId` (simulating an Inngest retry after a committed
      first attempt) reuses the existing `snapshotPath` and does not overwrite it with a
      snapshot of the seeded data.
- [ ] `pnpm db:seed:dev -- --email dev@carbon.ms --dataset satellite` still produces
      identical `Seeded row counts` to `.ai/runs/2026-08-13-seed-baseline.txt` after the
      `beforeTiers` → `wipeFirst` migration, and the structural sums in the sibling
      `-structural.txt` also match.
- [ ] Onboarding with "Use a demo template" leaves a `ready` marker and a review row on
      Settings → Demo Data; clicking Revert there yields a company with the clean seed
      (chart of accounts, `EA`, sequences, HQ location present; zero `item` rows).
- [ ] A non-internal user on a non-local deployment gets redirected away from
      `/x/settings/demo-data`, the nav entry is absent, and the status API returns 404.
- [ ] Applying `precision` to a company that already has a `satellite` template applied
      (post-Keep) succeeds, and the resulting company contains only precision data.

## Risks

| Risk | Mitigation |
|---|---|
| The dev wipe's `PRESERVED_TABLES` set was written for a dev company and may preserve something a real customer company holds that then collides with tier inserts | The wipe ends in `assertWipeClean` (`wipe.ts:247`), which throws if anything survived that should not have. Apply is transactional, so a collision rolls back rather than corrupts. Exercise against a company with real data as an acceptance step. |
| Snapshot of a large real company is slow or large | Same cost profile as an existing backup export, which already runs on these companies. The progress modal's existing 120 s "still working" watchdog copy applies. |
| Storage orphans after revert | Pre-existing and unchanged: restore and revert only ever copy files in, nothing sweeps `private/{companyId}/`. Documented in `company-backup-restore.md`; not introduced or worsened here. |
| Removing `beforeTiers` breaks an unknown consumer | It has exactly one call site (`seed-dev.ts:65-72`) and no exports-map subpath, so it is unreachable from any other workspace package. Verified. |
| Onboarding regression — every new company now takes a snapshot | The snapshot is of a freshly seeded company (config only, no business rows). If it throws, the marker reads `failed` and onboarding's existing fatal-enqueue behaviour is unchanged. |

## Open Questions

All resolved with the user before this document was written.

- [x] Where should the apply/revert option live? — **Answer:** A new `Settings → Demo
      Data` page in the System group, beside Backups. Keeps the Backups page about the
      customer's own data and gives demo data its own honest home.
- [x] What happens to existing data when a template is applied mid-life? — **Answer:**
      Snapshot, wipe, apply, then a Keep/Revert review row. Mirrors restore; refusing
      would make "apply anytime" untrue for any company in use.
- [x] Who can see and use it? — **Answer:** The same gate as Backups
      (`canAccessBackups` — internal email or local dev). Same blast radius, same
      unhardened multi-tenant caveats; prove it internally first.
- [x] How long should revert stay available? — **Answer:** Until Keep is clicked, and a
      pending review blocks a further apply. Matches restore, forces an explicit
      decision, bounds storage to one snapshot per company.
- [x] Should onboarding also snapshot, so a signup-time template is revertible later? —
      **Answer:** Yes. The company is nearly empty so the snapshot is cheap, and it keeps
      one code path rather than two behaviours.
- [x] Which templates can a user pick in Settings? — **Answer:** All four datasets by
      name, not filtered by the company's recorded industry. It is a demo tool, and
      filtering would strand companies with no industry set.
- [x] Does re-applying duplicate the global `period` rows, which the company-scoped wipe
      cannot delete? — **Answer:** No. Resolved against the code rather than the user:
      tier 12 already read-then-inserts and `12-planning.ts:133` documents exactly this
      case.

## Changelog

- **2026-08-18** — Initial spec. Six open questions resolved with the user before
  writing. Codebase audit established the two-wipes constraint that determines the
  design, and confirmed `buildCompanyBackup` and `applyDataset`'s transaction hook as the
  intended reuse seams.
