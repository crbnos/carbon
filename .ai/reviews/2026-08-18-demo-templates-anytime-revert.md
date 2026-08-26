# Thermo-nuclear review — demo templates anytime + revert

Branch: `feat/onboarding-templates`. 18 files changed, 530+/98-, plus 6 new source files.
Reviewed against the code OUTSIDE the diff (`company-restore.ts`, `company-export.ts`,
`backups.service.ts`, `backups.tsx`, `BackupProgressModal.tsx`, `RestoreReviewRow.tsx`).

**Verdict: do not merge as-is.** Three blockers, two high. All of them trace back to one
root cause: this feature was written as a *fourth parallel copy* of a lifecycle the repo
already implements three times, and the copy silently dropped safety mechanisms the
originals have.

---

## The root cause

`externalIntegrationMapping` markers now have **three** independent CRUD triples:

| | read | write (patch-merge) | clear | throttled reporter |
|---|---|---|---|---|
| `company-export.ts` | inline | `upsertExportMarker` L243 | `clearExportMarker` L279 | inlined, L313-326 |
| `company-restore.ts` | `readRestoreMarker` L281 | `writeRestoreMarker` L305 | `deleteRestoreMarker` L377 | `makeProgressReporter` L350 |
| `company-template.ts` **(new)** | `readTemplateMarker` L46 | `writeTemplateMarker` L77 | `clearTemplateMarker` L118 | `makeTemplateProgress` L140 — **no throttle** |

The merge bodies are character-for-character identical modulo the run-id field name
(`company-template.ts:88-93` vs `company-restore.ts:317-322`). The metadata types differ in
three optional fields; the status unions are *identical* (`"running" | "ready" | "failed" |
"reverting"` — `company-template.ts:25`, `company-restore.ts:216`). `JobProgress` and
`ExportProgress` are the same type declared twice, and the new file inlines it a third time.

`company-backup.ts` already owns `BACKUP_INTEGRATION` (L30) and `RESTORE_INTEGRATION` (L224)
— the constants are centralised, the helpers never were. The new file even declares
`TEMPLATE_INTEGRATION` at its own L21 instead of beside its two siblings.

**Code judo:** one generic marker module in `company-backup.ts` —
`readMarker/writeMarker/clearMarker/makeThrottledReporter`, generic over the metadata extras
— deletes ~120 lines across three files and makes finding #1 *unrepresentable*. The throttle
stops being something a fourth copy can forget.

---

## 1. BLOCKER — unthrottled progress writer runs inside the restore transaction

`company-template.ts:140-147` writes the marker on **every** tick. Each write is a
read-then-write (`writeTemplateMarker` calls `readTemplateMarker` unconditionally at L87), so
**2 Supabase round-trips per tick**.

That reporter is handed straight to `wipeAndLoad` as `onProgress` (`company-template.ts:407`),
which fires once per wiped table (`company-restore.ts:130-139`) and once per loaded table
(`company-restore.ts:205-209`) — a few hundred tables. So a revert costs **~1000+ SELECT+UPDATE
pairs on a JSONB column, interleaved with the load loop, inside `db.transaction()`**
(`company-restore.ts:155`), lengthening the transaction it is nested in.

`company-restore.ts:348-375` has `PROGRESS_THROTTLE_MS = 250` for exactly this reason, with a
comment explaining it. The new copy dropped it.

The forward-apply path is safe only by accident: `applyDataset` takes no `onProgress`, so it
only reaches 4 phase-level ticks (L236/259/268/279).

**And the payoff for all of it is zero.** Grep confirms neither `TemplateReviewRow.tsx` nor
`demo-data.tsx` renders `run.progress` — the only hit is a comment. The `progress` field on
`TemplateMeta`, `makeTemplateProgress`, `noProgress`, and the 500 ms poll all exist to feed a
spinner that displays no progress.

**Remedy — pick one, not both:** either delete the progress plumbing entirely (`TemplateMeta.progress`,
both reporter helpers, the fast poll — the spinner needs none of it), or wire the real modal
per finding #6 and take the shared throttled reporter with it. Shipping the writes with no
reader is the one option that is strictly worse than either.

## 2. BLOCKER — "Dismiss" orphans the snapshot, and the server never checks

`companyTemplateRevertFunction`'s catch (`company-template.ts:434-450`) sets `status: "failed"`
but deliberately **keeps `snapshotPath`** so the revert can be retried — correct. The UI then
renders a Dismiss button for `failed` (`TemplateReviewRow.tsx:93-97`), which posts `intent:
"dismiss"`, which calls `dismissCompanyTemplateFailure` (`demoData.server.ts:52-61`) — an
unconditional `DELETE ... WHERE integration = 'company-template' AND companyId = ?`.

No `removeStoragePrefix`. So on a reachable path — revert fails, user clicks Dismiss — the
marker is deleted, the `_pre-template-<runId>` folder is stranded in the company bucket with
nothing pointing at it, and the user's only pre-apply copy becomes unreachable. Same on an
apply that fails after the snapshot step.

Worse, the action does not check the marker's status at all
(`demo-data.tsx:151-157`): a POST with `intent=dismiss` while status is `ready` deletes a live
marker, silently forfeiting a revert the user was still entitled to.

**Remedy:** dismiss must read the marker, refuse unless `status === "failed"`, and
`removeStoragePrefix(backupDir(snapshotPath))` before deleting the row. The finalize function
already does exactly this (`company-template.ts:336-341`) — route Dismiss through an Inngest
function that shares it rather than reaching into the table from the app.

## 3. BLOCKER — `getCompanyTemplateRun` is a third copy, in the wrong file

`settings.service.ts:1582-1623` is a near-clone of `getCompanyExportRun`
(`backups.service.ts:197-229`): same `.from("externalIntegrationMapping").select("metadata,
createdAt").eq(...).maybeSingle()`, same `{data,error}` early returns, same three coercion
defaults (`status ?? "running"`, `progress ?? null`, `startedAt ?? marker.data.createdAt`).
~34 of 42 lines are the same shape. `getCompanyRestoreRuns` (`backups.service.ts:146-181`) is
a third copy of the same coercion.

It also landed in the wrong file. Its two siblings live in `backups.service.ts` (229 lines);
this went into `settings.service.ts` (now 1623 lines) to satisfy the `module-shape`
conformance rule. But `baseline.json:2` already exempts
`module-shape::settings::extra-service:backups.service.ts` — putting it beside its siblings
adds **no** new violation and needs no baseline edit. The earlier conclusion that the rule
forced it into `settings.service.ts` was wrong.

**Remedy:** one `readIntegrationMarker(client, companyId, integration)` in
`backups.service.ts` returning `{ meta, createdAt }`; the three readers become thin typed
projections over it.

## 4. HIGH — the polling effect's deps turn a 500 ms interval into a hot loop

`demo-data.tsx:184-191`:

```ts
useEffect(() => {
  if (!inFlight || !liveRun) return;
  const href = `/api/settings/demo-data-status/${liveRun.templateRunId}`;
  load(href);
  const id = setInterval(() => load(href), 500);
  return () => clearInterval(id);
}, [inFlight, liveRun, load]);
```

`liveRun` is `statusFetcher.data?.run ?? run` — a **new object on every poll response**. So
each response changes the dep identity, tears the effect down, and immediately calls
`load(href)` again before re-arming the interval. The effective poll rate is network RTT, not
500 ms.

`BackupProgressModal.tsx:184-198` — the code this is copied from — deps on
`[isExport, runId, done, load, revalidator]`: stable primitives only. The copy deviated in
exactly the way that breaks it. Depend on `liveRun.templateRunId`, not `liveRun`.

## 5. HIGH — split-brain between `run` and `liveRun`

`demo-data.tsx:173-177` computes `active` and `pending` from the **loader's** `run`, while
`datasetLabel` and `inFlight` use the **polled** `liveRun`. So `TemplateReviewRow` renders a
stale status: when the poll reports `ready`, polling stops but the row keeps showing
"applying…" until the 2500 ms revalidator lands, and Keep/Revert appear a beat late.

Two sources of truth for one run is the smell; the fix is to derive everything from one
merged value. Note this also silently dropped both watchdogs the original has — `slow`
(`BackupProgressModal.tsx:163`) and the pre-heartbeat `stalled`
(`BackupProgressModal.tsx:181`) — so a template job that never writes its first marker spins
on this page forever with no escape copy.

## 6. MEDIUM — the Task 10 blocker was self-inflicted; reuse costs ~35 lines

I previously reported `JobProgressModal` as effectively unreusable. That was overstated.
`BackupProgressModal.tsx` has four hardcodings: the mode union (L17, L22-25, L118), the literal
poll URLs (L191, L205), the flat response type (L128-134), and the copy ternaries (L246-263,
L287-320).

Only the **response shape** is a real obstacle, and it is an obstacle the new code created:
`settings.demo-data-status.$templateRunId.ts:30` returns `{ run }` (nested, `null` for absent)
where the modal consumes flat `{ status, rows, error, progress, startedAt }` with `"gone"` as
the absence sentinel. The two status routes are otherwise 26 of 31 lines identical.

Change the new endpoint to the flat shape and the modal costs **zero** lines for it; add the
`snapshot`/`wipe`/`apply` phases to `PHASE_ORDER`/`PHASE_LABELS` (~12), take a `statusHref`
prop (~2), lift the title/body ternaries into a per-mode record (~20, mostly moved). ~35 lines
total, and it restores the watchdogs lost in #5 and gives the progress writes of #1 a reader.

## 7. LOW — comment density, and one comment that is now false

The non-obvious comments earn their place: the idempotent-snapshot rule
(`company-template.ts:233-235`), the two-wipes asymmetry (`datasets/index.ts:64-69`), the
concurrency reasoning (L153-157), why the marker parks vs clears (L66-76). Keep all of those.

But `company-template.ts:379` — "Flag the run as reverting so the progress modal can show it
live" — describes a modal that is not wired up (#1). A comment naming a consumer that does not
exist is worse than none. And `noProgress` (L134-137) is a named async no-op that exists only
to satisfy Biome's `noEmptyBlockStatements`; it disappears under either remedy in #1.

`TemplateCards.tsx:19-24` and `TemplateReviewRow.tsx:18-23` both open with docstrings whose
main content is "modelled on Backups' X" — which, given findings #3 and #6, is the review
comment rather than the answer to it.

---

## What is genuinely good

- `wipeFirst` replacing the `beforeTiers` callback (`datasets/index.ts:64-72`) is the right
  call: narrower than the callback, and it keeps `wipeCompanyBusinessData` unexported so no
  caller can wipe without re-seeding.
- Tying `wipeFirst` to `takeSnapshot` (`company-template.ts:276`) so the two can never diverge.
- The idempotent snapshot reuse (L231-235), matching `company-restore.ts`'s rule for the same
  reason.
- `resolveRestoreScope` extracted rather than re-derived (`company-restore.ts:265-278`).
- `demoData.server.ts` correctly mirrors `backups.server.ts` — right pattern, right layer.
- `companyId` from `requirePermissions` and never the URL in the status route; 404 rather than
  403 on the gate.

## Suggested order

1. #2 (data-loss-adjacent) and #1 (delete the dead progress plumbing — the cheapest fix is the
   removal, not the throttle).
2. #4 and #5 — both are one-line-ish dep/derivation fixes.
3. #3 — move the reader to `backups.service.ts`, extract `readIntegrationMarker`.
4. #6 if you want the phased bar; otherwise close the Task 10 blocker as "spinner is final".
5. The shared marker module (root cause) — the largest win, and the one that stops copy #5.
