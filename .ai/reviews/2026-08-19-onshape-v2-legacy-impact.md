# Onshape v2 — impact on existing legacy installs

Audit of `feat/onshape-v2` (26 commits ahead of `main`) answering one question: if this merges,
does a customer already using the Onshape integration, who never touches the new settings,
experience any change?

Method: six independent auditors over each shared surface, every finding adversarially refuted by a
second agent, then a completeness critic over what nobody checked, plus direct verification of each
conclusion against source. 26 candidate findings, 19 survived refutation, 7 refuted; 12 coverage
gaps examined, 3 of them substantive.

## Status — implemented 2026-08-19

All three recommendations are applied in the worktree, uncommitted apart from the staged route.

| # | Change | State |
| --- | --- | --- |
| 0 | Merge blocker | `integrations.onshape.v2.elements.ts` staged (`git add`). Typecheck resolves it. |
| 1 | Legacy BOM import | `20faf4496`'s two code files restored to `main` byte-for-byte (`git diff main` on both is empty). The commit stays in branch history — `git cherry-pick 20faf4496` onto `main` reconstructs it for its own PR. |
| 2 | Asset attach CAS | `onConcurrentChange?: "overwrite" \| "refuse"` added to `AttachOnshapeAssetsInput`, default `"overwrite"`. Legacy (`onshape-revision-sync`, `onshape-backfill`) takes the default and is unchanged from production; `onshape-v2-assets.ts` passes `"refuse"`. |
| 3 | OAuth reconnect | Left as fixed — `onshapeCompanyId` dropped from the merge. The only remaining difference from `main` is that `assetSyncEnabled` survives a reconnect. |

Docs corrected to match: `.claude/rules/onshape-integration.md` now describes `main`'s BOM writer
(matched item gets only `updatedBy`/`updatedAt`; a new item is always `Part`/`EA` with an empty make
method) and flags the unreleased-revision bug as open with the fix off-branch.
`.ai/plans/2026-08-13-onshape-import-revisions.md` records why Phase 1's code was pulled out.

Verification: zero Onshape errors in the ERP or `@carbon/jobs` typecheck. The ERP's 11 errors are the
pre-existing baseline — `packages/ee/src/accounting/**`, `sales.service.ts`, `workflows.server.ts`,
`accounting.ee.service.ts` — none of which this branch touches. `@carbon/jobs` tests 497/497 in 32
files. Biome clean (3 pre-existing `console.error` warnings). Local stack restarted, including a
forced recreate of the `edge-runtime` container so the reverted `sync` function is what serves.

Everything below is the audit as written before those changes.

## Verdict

Legacy is unaffected **except the BOM import**. One commit — `20faf4496` — changes it, ungated.
Everything else is either gated on `pipeline === "next"`, purely additive, or a fix to a
pre-existing bug.

Two things outrank that finding in urgency:

- **Merge blocker.** `apps/erp/app/routes/api+/integrations.onshape.v2.elements.ts` is untracked
  (`??`), and two uncommitted files reference it — `path.ts:189` adds `onShapeV2Elements`, and
  `OnshapeUnreleasedPicker.tsx:22` type-imports its loader. Committing the tracked changes without
  `git add`ing that file fails typecheck (TS2307) and the ERP Docker build in `deploy.yml`, which
  blocks the deploy for **every** customer, Onshape or not.
- **Deploy skew makes the BOM change destructive, not merely different.** See below.

## Why the gating holds

On `main` the Onshape integration's `metadata` can hold exactly five keys, per the jsonschema in
`20260703165330_onshape-asset-sync-jsonschema.sql`:

`baseUrl`, `credentials`, `scope`, `onshapeCompanyId`, `assetSyncEnabled`

Every key the v2 pipeline reads — `pipeline`, `attachAssetsOnRelease`, `releaseImportV2`,
`allowUnreleasedSync`, `releaseImportEnabled`, `releaseImportMode`, `webhookSigningSecret` — is new
on this branch. No existing row can contain one. Every v2 read site tests `pipeline === "next"`
strictly (`packages/ee/src/onshape/lib/settings.ts:79`), so an absent key resolves to legacy by
construction rather than by falling through to a default.

## Proven unchanged

| Area | Evidence |
| --- | --- |
| Migrations | Both are data-only `UPDATE`s on the `integration` catalog row. `required` stays `["baseUrl","credentials"]`; no `additionalProperties: false`. |
| Existing rows re-validated? | No. `verify_integration` is `BEFORE INSERT OR UPDATE ON "companyIntegration"` (`20240119095150_integrations.sql:65`); updating the catalog row does not fire it. |
| Schema changes | None. `git diff --stat main...HEAD -- packages/database` contains only the two data migrations. `externalIntegrationMapping.allowDuplicateExternalId` already exists (`20260128140000`). |
| Webhook routing | The "no consumer enabled" gate still precedes the body read. For `isV2 === false` and `releaseImportEnabled` absent, the only dispatch is `onshape-revision-sync` with a payload identical to main. |
| Webhook signature | Only enforced when `webhookSigningSecret` is non-empty. No UI on main can write that field. |
| Job double-processing | Every new Inngest function has its own event name; no two functions share a trigger. |
| Legacy jobs | `onshape-revision-sync.ts` and `onshape-backfill.ts` are not in the branch diff at all. |
| `onshape-sync-element.ts` | Additive only — `partIds` / `configuration` are optional and omitted by every legacy caller. |
| Locale catalogs | All 13 `.po` files verified additive: removed = 0, added = 107, identical across `en de es fr hi it ja ko pl pt ru tr zh`, plus one further msgid uncommitted. No existing translation changed. |
| Root layout projection | `_layout.tsx` now returns six keys per integration, dropping not just most of `metadata` but the whole `integration` row the view selects via `i.*` (`name`, `description`, `logoPath`, `jsonschema`, `visible`). Applies to every integration for every customer. Safe: `integrations.list` is read at exactly one site (`useOnshapePipeline.ts:20`); the other 15 consumers call only `.has(id)`, and the settings page loads its own data via `getIntegrationsWithHealth`. This is a security fix — the raw column holds plaintext OAuth tokens and was being serialized into every authenticated page. |
| Customer with no Onshape row | The `integrations` view CROSS JOINs company × integration and coalesces to `metadata '{}'` / `active FALSE`, so every company has an inert row. `useOnshapePipeline` returns `isConnected: false → isV2: false`, and both new render sites in `PartsTable.tsx` gate on it. |
| Per-company vs per-instance | Gating is per-company throughout: `getOnshapeV2Settings` is company-scoped, the webhook is keyed by the `$companyId` URL segment, and `registerOnshapeWebhook` matches subscriptions on `callbackPath(companyId)`. Every new Inngest function keys concurrency on a per-event value with no account-level throttle, so a v2 company cannot starve a legacy company's sync. |
| Legacy POST contract | `integrations.onshape.sync.ts` parses rows with `onShapeDataValidator` (`data.ts`, not in the branch diff). It is a plain `z.object` with no `.strict()`, so the two fields the new route adds are stripped exactly as on main. Unchanged — but by luck; nothing in types or tests pins that contract. |
| New `ee/onshape/lib` modules | `bom.ts`, `reconcile.ts`, `resolve.ts` are re-exported from the barrel a legacy route imports, but every cross-module import in them is `import type`, so the barrel gains no runtime dependency and no module-load side effect. |
| Rollback | Migrations are forward-only, so a revert leaves both jsonschema `UPDATE`s applied. Both are additive with `required` unchanged, and the validator fires only on `companyIntegration` INSERT/UPDATE, so rows carrying the new keys still validate under reverted code. |
| Self-hosted / older OAuth app | The requested scope is unchanged, and `hooks.server.ts` (which holds `ONSHAPE_WRITE_SCOPE` and `onshapeConnectionHasWriteScope`) is byte-identical to main. A pre-scope connection still reads read-only and still gets the same reconnect prompt. |

## What changes

### 1. Legacy BOM import — breaking, ungated

Commit `20faf4496` ("fix(onshape): make BOM re-sync revision-aware") changes two legacy-only files.
Neither contains a pipeline check.

Reachability: `BoMExplorer.tsx:166` renders `<OnshapeSync>` for every legacy customer →
`path.to.api.onShapeBom` (the modified preview route) → `path.to.api.onShapeSync` →
`functions.invoke("sync")` (the modified edge function). The v2 pipeline does not touch any of it;
it uses the `onshape-bom-import` Inngest job instead.

| Change | Location | Effect on a legacy customer |
| --- | --- | --- |
| Matched item's `name` and `description` overwritten from Onshape | `sync/index.ts:418` | Previously only `updatedBy`/`updatedAt` were written. A part deliberately renamed in Carbon reverts on the next sync. |
| New item cloned from the latest sibling revision | `sync/index.ts:479` | Was always `type: Part`, `EA`, `Inventory`. Now inherits type, UoM, tracking, replenishment, method type, description, mpn, thumbnail, model from a sibling. |
| Sibling's operations copied onto the new make method | `sync/index.ts:584` | New write. On main a BOM-created item got an empty make method. |
| Revision-less BOM rows fall back to the latest existing revision | `bom.ts:126-206` | Previously a blank-revision row matched only a revision-0 item; a miss created a new item. It now resolves onto an existing released revision and rewrites that method's materials. |
| `item.revision` persisted as `"0"` instead of `""` | `sync/index.ts:405` | Cosmetic. `getReadableIdWithRevision` already treats `""` and `"0"` identically, so matching is unaffected. |

This is a real fix, verified live in that commit: because Onshape only stamps a revision on
*released* versions, re-syncing an unreleased version was building a complete parallel item tree at
revision `""` and repointing the parent's make method at it, orphaning the real revision's children
silently. But it is a behavior change existing customers receive without opting in.

#### The two files must move together

The app and the `sync` edge function deploy on **separate, unordered GitHub workflows**:
`deploy.yml` (apps, Docker + Pulumi, slow) and `supabase.yml` / `functions.yml` (functions). If the
app is live and the edge function is not, the new BOM route returns the fallback `id` for a
revision-less row and the **old** edge function acts on it — and main's edge function already does
`deleteFrom("methodMaterial")` on the resolved child's make method before rebuilding
(`main:sync/index.ts:727`). The result is an existing released revision's BOM wiped and rebuilt from
an unreleased Onshape version.

That state is not hypothetical or transient on every instance:

- `functions.yml` has a **one-entry matrix — `govcloud`** — and reaches it over SSH, unordered
  relative to the app deploy.
- `ci/src/migrations.ts:92-98` runs `supabase functions deploy` **only** in the `else` branch. A
  workspace whose row carries a `postgresql://` connection string is migrated and then skipped, so
  it would run the new BOM route against the old edge function **indefinitely**.

Which hosted instances carry a connection string is workspace data, not in the repo — worth
confirming with Chase before merging this commit in any form. Reverting it from this PR removes the
question entirely.

### 2. OAuth reconnect — fixed in this audit

`upsertCompanyIntegration` replaces the whole `metadata` column, so on main every reconnect silently
wiped `assetSyncEnabled` and asset sync stopped until the customer re-toggled it. The branch merges
existing metadata instead, which fixes that — but it also preserved `onshapeCompanyId`, a cache of
the *previous* token's Onshape tenant that `resolveAndStoreOnshapeCompanyId` returns without ever
re-checking. Reconnecting with a different Onshape account would have kept resolving to the old
tenant and registered the release webhook against it.

Fixed: `onshapeCompanyId` is now dropped from the merge so it re-resolves, matching main exactly.
The only remaining difference from main is that `assetSyncEnabled` survives a reconnect.

### 3. Asset attach — new failure mode under concurrency

`onshape-attach.ts:393` turned the `item.modelUploadId` write into a compare-and-set that throws
when it matches zero rows. This runs on the legacy `onshape-revision-sync` and `onshape-backfill`
paths with no pipeline gate. On main the update was unconditional and always succeeded.

Self-healing in practice: the call sits inside `step.run` with `retries: 3` and a per-element
concurrency limit of 1, so a lost race re-reads and succeeds on retry. It requires a genuine
concurrent writer (a backfill racing a live webhook, or a manual model upload) to trigger at all.

### 4. Settings drawer — visible only

A legacy customer opening Settings → Integrations → Onshape now sees a Pipeline selector (Legacy /
Onshape v2) above the asset-sync switch, plus Release import and Security groups. Saving with no
changes persists seven new keys (`pipeline: "legacy"`, `attachAssetsOnRelease: true`, and five
others). All are inert while `pipeline` is legacy.

## Can legacy be made completely unaffected?

Yes. The blast radius is three files, and the architecture cooperates: **v2's BOM import shares no
code with the legacy one**, so the legacy path can be restored without touching v2.

| # | Change | How | Cost |
| --- | --- | --- | --- |
| 1 | Legacy BOM import | Revert `20faf4496`'s two code files from this branch and ship it as its own PR. `git apply --reverse --check` passes; no later commit touches either file, and no v2 code references them. | Splits one PR into two. The fix ships on its own timeline. |
| 2 | Asset attach CAS | Add `onConcurrentChange?: "overwrite" \| "refuse"` to `AttachOnshapeAssetsInput`, defaulting to `"overwrite"` (main's behavior); v2 callers pass `"refuse"`. | ~5 lines. |
| 3 | OAuth reconnect | Already fixed for `onshapeCompanyId`. To reach byte-identical legacy, gate the whole merge on `existingMetadata.pipeline === "next"`. | Not recommended — it re-introduces the silent asset-sync disabling on every reconnect. |

Gating the BOM changes on `pipeline === "next"` instead of reverting them does **not** work: v2 never
calls the edge function or the legacy preview route, so gated code would be dead.

## Recommendation

Before anything else, `git add apps/erp/app/routes/api+/integrations.onshape.v2.elements.ts`.
Without it the merge does not build, for every customer.

Then take options 1 and 2 and leave the OAuth merge as fixed.

That gives a v2 PR in which the legacy pipeline is byte-identical to production except for one
strictly-beneficial reconnect fix, and moves the legacy BOM correction into a separate PR that can
be reviewed and timed on its own merits.

The correction is worth shipping — it fixes silent data corruption. But it cannot be split across
the two files, and the app and edge function deploy on unordered workflows with at least one path
where the function never updates, so it needs a deployment plan of its own. That is a second reason
to separate it, on top of the first: bundling a behavior change to a live feature inside an opt-in
feature PR is what makes "does this affect existing customers?" hard to answer, which is the
question that prompted this audit.
