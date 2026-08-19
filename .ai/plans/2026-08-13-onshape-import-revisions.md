# Onshape import: revision-aware sync + release-driven change notices

**PAUSED 2026-08-14 — awaiting details from Heaviside before Phase 2.** State: Phase 1 done,
verified, uncommitted. Pickup steps in "Picking this up later" at the bottom.

**2026-08-19 — Phase 1's code was REVERTED out of `feat/onshape-v2`.** It is correct and worth
shipping, but it changes the legacy BOM import that existing customers use today, ungated, and the
ERP route and the `sync` edge function deploy on separate unordered workflows — an app-ahead-of-
function window wipes and rebuilds an existing released revision's BOM. It ships as its own PR with
its own deployment plan. The commit is still in the branch history: `git cherry-pick 20faf4496`
onto `main` reconstructs it. Reasoning and evidence:
`.ai/reviews/2026-08-19-onshape-v2-legacy-impact.md`.

Branch: `feat/onshape-import-revisions`. Driven by Heaviside report: re-syncing a BOM after a
revision does not update sub-parts. Reference docs (project dir, outside repo):
`onshape-release-actions.md` (the three Onshape UI routes that fire `onshape.revision.created`),
`week1-run-the-business/claude-diagnosed-bugs.md` CDF-008/009 (Onshape picker pagination +
combobox bugs, adjacent but separate).

## Confirmed defects (code-verified)

1. **Matched items discard the payload.** `packages/database/supabase/functions/sync/index.ts`
   existing-item branch (~line 409) writes only `updatedBy`/`updatedAt`. Name, description and the
   rest of the Onshape row are thrown away on every re-sync.
2. **Revision advance bypasses revision semantics.** When `readableIdWithRevision` has no match,
   the sync inserts a brand-new `item` row with hardcoded defaults (`itemTrackingType:
   "Inventory"`, `unitOfMeasureCode: "EA"`). It never copies from the existing sibling revision
   (`createRevision` in `items.service.ts` copies core fields + method). Result: a "revision" that
   shares nothing with its predecessor.
3. **No change-notice path.** Customer expectation: an Onshape release creates a change notice in
   Carbon for review, rather than silently mutating items. Both halves exist and are unwired:
   webhook `onshape.revision.created` → `carbon/onshape-revision-sync` (link-only asset attach,
   `onshape-revision-sync.ts`); Change Notice module has `insertChangeNotice`,
   `addChangeNoticeAffectedItem`, `createChangeNoticeDraftMethod`, `applyChangeNotice` with a
   Revision change type incl. supersession.

## Onshape semantics that shape the design (verified live 2026-08-13)

- Revision + Released state exist only on the release version's BOM. Workspace/version BOMs show
  empty revision, "In progress". Syncing an unreleased version therefore imports revision "0"
  rows — exactly what Heaviside hit.
- Any Part Studio edit flips every part in that studio back to "In progress".
- Test model ready: RD-410 doc, release REL-001 (all 9 items rev A), unreleased V2 (housing
  35→40mm) and V3 (PCB 1.6→2.0mm, inside SA-800 sub-assembly).

## Plan

### Phase 0 — live verification (no code) — DONE 2026-08-13
- Onshape integration installed on local stack (enterprise edition unlock in .env; OAuth flow
  auto-approved; integration HEALTHY).
- REL-001 sync: correct. Full tree created at revision A, quantities right (EL-404 ×2),
  `readableIdWithRevision` matching works when revisions are present.
- V3 sync (unreleased version): **Heaviside bug reproduced exactly.** BOM rows carry empty
  Revision → nothing matches the .A items → the sync created a complete parallel item tree at
  revision `""` (8 duplicate items) and repointed RD-410.A's make method at the bare items.
  The .A children and their make methods are orphaned out of the tree. No warning anywhere.
- New defects found during verification:
  - `revision ?? "0"`: Onshape sends `""` not undefined, so items get revision `""` (not `"0"`).
    Both map to the same `readableIdWithRevision` but they are distinct values in `item.revision`.
  - **Descriptions are dropped entirely** — the insert path never writes `description`; all synced
    items have NULL description despite Onshape carrying them.
  - **Everything is created replenishment "Make"** — leaf purchased parts (EL-402 IC, MC-101
    gland) land as Make/MTO, which poisons MRP downstream.
- Environment note for Brad/devs: local edge functions were dead — deno.land CDN currently sends
  `content-encoding: br` with an UNCOMPRESSED body for
  `std@0.160.0/crypto/_wasm_crypto/lib/deno_std_wasm_crypto.generated.mjs` (pulled transitively
  via `deno.land/x/postgres@v0.17.0`), so Deno's graph fetch fails with "brotli error". Worked
  around by remapping `https://deno.land/std@0.160.0/` → GitHub raw in
  `packages/database/supabase/functions/deno.json`. Verified byte-identical bodies; remap is
  content-identical. Candidate upstream PR / revert when deno.land fixes their CDN.

### Phase 1 — fix the sync edge function
- Matched branch: update `name` and Onshape-sourced fields on the item row (decide the exact
  allowlist; do not clobber Carbon-owned fields like tracking type or replenishment that the user
  may have changed post-import).
- New-revision branch: when siblings exist for `readableId`, copy core fields from the latest
  sibling (mirror `createRevision` semantics inside the Deno function — it cannot import
  `~/modules`). New readableIds keep the current default path.
- Typecheck + manual re-sync verification against RD-410.

### Phase 2 — release → change notice (new Inngest function)
- Design position (Raul, 2026-08-13): an Onshape release should push the release's details into
  Carbon — the existing `onshape-revision-sync` is link-only asset attach and never creates or
  revises items; today an unmatched release ends as skip `no-matching-item` and nothing happens.
- New function `onshape-release-change-notice` on the same webhook event, gated by a new
  `companyIntegration.metadata` toggle (pattern: `assetSyncEnabled`).
- Group webhook events by release (`releaseKey` — already computed and surfaced on the
  `no-matching-item` skip result), create one change notice per release; affected items matched
  by `readableId`; Revision change type; leave in draft for human review.
- Local testing: three loops, cheapest first — synthetic POST at the receiver (no signature
  verification, so nothing to forge); direct `carbon/onshape-revision-sync` at the local Inngest
  dev server; real Onshape delivery over a cloudflared tunnel with `ERP_URL` pinned via crbn's
  `#force` hatch. Runbook + scripts: `onshape-integration/local-webhook-testing.md` in the
  project dir. Backfill (`onshape-backfill.ts`) runs the SAME per-element sync code with no
  tunnel at all — real release data, Carbon-initiated.
- **Design consequence:** put the change-notice creation in the shared per-element/`releaseKey`
  code, not in a webhook-only Inngest function. Shared, and backfill exercises it locally too;
  webhook-only, and that test path is given up for nothing.
- Pipeline facts (verified in code 2026-08-13): one `onshape.revision.created` event per item in
  the release package, fully async from the release; receiver route gates on active integration +
  `assetSyncEnabled`; Inngest fn is idempotent on messageId, concurrency 1 per elementId, 3
  retries. Only a release package reaching Released fires the event — versions, release
  candidates and obsoletion do not (see `onshape-release-actions.md`).
- Unproven claim to test before shipping: the webhook is registered company-scoped (no document
  filter), which by documented semantics should deliver for ALL documents in the Onshape company
  — inferred, not observed. Prove via tunnel: enable toggle, release from two documents. Edge
  case not ruled out: delivery limited to documents the authorizing user can read.

### Phase 3 — UI guidance (small)
- OnshapeSync.tsx: surface that syncing an unreleased version imports no revisions (the Heaviside
  trap); show State/Revision from the release when available.

## Decisions pending
- Field allowlist for matched-item updates.
- Whether BOM-import revision advance should also route through a change notice, or only the
  webhook path (v1: only webhook path).

## Progress
- [x] Test model prepared in Onshape (REL-001 + V2/V3)
- [x] Enterprise edition unlock for local integrations UI
- [x] Phase 0 verification — bug reproduced, DB state recorded, plan updated
- [x] Phase 1 — DONE 2026-08-13, verified live against RD-410 (REL-001 then V3):
  - BOM route: empty-revision rows fall back to the LATEST existing revision of the same
    readableId (named > initial, then newest) instead of only exact `readableIdWithRevision`.
    V3 re-sync now matches the .A items — no duplicate tree, method lines stay on .A.
  - Sync fn matched branch: updates `name` + `description` (Onshape-owned fields only).
    Verified: EL-703.A description 35mm→40mm after V3 sync.
  - Sync fn insert branch: copies createRevision's field set from the latest sibling
    (type, UoM, tracking, replenishment, method type, description, sourcingType, thumbnail,
    mpn, modelUploadId) and copies the sibling's BOP operations onto the new make method.
    Conditional spreads — NOT NULL defaults (sourcingType) must not receive explicit null.
  - Revision normalized `""`→`"0"`; descriptions imported on create (verified in DB).
  - Files: `integrations.onshape.d.$did.v.$vid.e.$eid.bom.ts`, `sync/index.ts`,
    `functions/deno.json` (CDN workaround). ERP typecheck green; biome clean (new code).
  - Not yet committed.
- [ ] Commit Phase 1 (3 files + this plan) — awaiting Raul's go
- [ ] Phase 2
- [ ] Phase 3 (note: sibling-copy insert path not yet exercised live — needs a release rev B
  sync once a second release exists; unit follows with Phase 2 work)

## Session notes 2026-08-13/14
- Local stack is DOWN. Background `crbn up` tasks were killed 4× this session leaving
  half-states; run it in Raul's own terminal instead:
  `crbn down && crbn up --no-portless --no-migrate --no-regen --all`.
- Flag to Brad (not yet sent): deno.land CDN br-mislabeling breaks all local edge functions;
  workaround committed in `functions/deno.json`.
- Parked: replenishment defaults to "Make" when the Onshape BOM has no "Purchasing Level"
  column — poisons MRP for purchased leaf parts.

## Picking this up later

Paused 2026-08-14 pending client input. Questions the client answer should settle (the Phase 2
design decisions):
1. Scope of import: change notice only referencing affected items, or change notice plus
   auto-created draft revision items?
2. What should happen when a release contains items Carbon has never seen (first-import case)?
3. Any workflow expectations around review/approval of the change notice before revisions apply?

Resume sequence:
1. Worktree `carbon-feat-onshape-import-revisions`, branch `feat/onshape-import-revisions`.
   Verify the 3 modified files + this plan are still uncommitted (`git status`); commit them
   first (revert any regenerated `types.ts` drift; gh account BettrCallRaul).
2. Check whether main moved under `sync/index.ts` / the BOM route since 2026-08-13 (last
   related upstream commit was #1376) and rebase if so.
3. Stack boot — Raul's own terminal, never a background task:
   `crbn down && crbn up --no-portless --no-migrate --no-regen --all`.
4. Drop the deno.land CDN workaround from the commit — almost certainly dead. Upstream #1371
   (`acdbcad23`, the only commit to touch these three files since 2026-08-13) replaced
   `deno.land/x/postgres@v0.17.0` with `jsr:@db/postgres@0.19.5` in `functions/deno.json`, which
   is the exact transitive dependency that pulled the brotli-mislabeled std file. Rebase, remove
   the remap, confirm edge functions boot. Also drops the "flag to Brad" item.
5. Build Phase 2 per the section above. Local testing is solved — runbook and scripts at
   `onshape-integration/local-webhook-testing.md` (tunnel + `ERP_URL` `#force` pin, synthetic
   POST, direct Inngest event, and the tunnel-free backfill path). Production Inngest is
   never involved.
6. Test model is ready in Onshape: RD-410, REL-001 released (rev A), V2/V3 unreleased. A
   second release (REL-002 → rev B) is the missing live test for the Phase 1 sibling-copy
   insert path.
