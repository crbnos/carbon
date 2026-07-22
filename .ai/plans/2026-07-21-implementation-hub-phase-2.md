# Implementation Hub Phase 2 — Self-Serve to Activated

## Context

Carbon's self-serve customers churn at the three points the current Implementation Hub structurally ignores: getting their data in, proving the system on real orders, and surviving the switch off old systems. Today's self-serve journey is three gates (Configure → Train → Go-Live); data migration and acceptance are paid-tier-only. The consultant blueprint plus the intake template — as amended by Chase — redesign self-serve into a Day-One experience plus **seven phases**, moving the finish line from cutover to **activation**: the factory relying on Carbon for day-to-day operations, marked by a gamified 10-business-day usage streak visible only between cutover and activation. Goal: activate more customers, make starting real production on Carbon easy and effective.

### Decisions locked with Chase (these override the PDFs where they differ)

1. **Seven phases for ALL tiers**; Phase 1 = the intake itself, named **"Tell Us How You Run"**; always re-editable. Designed for self-serve; Guided/Enterprise run the same 7-gate journey, with Carbon staff able to complete the intake on the customer's behalf (existing staff-edit machinery).
2. **Activation** = sustained reliance (measured internally forever); the 10-day streak is the graduation ceremony. Scoreboard visible ONLY between cutover and activation; hub closes at activation; deferred-items menu lives in the closing celebration; relapse detection continues internal-only.
3. **Streak = Duolingo mechanics**: streak + 2 auto-applied Streak Freezes + milestones (days 3/5/10) + cumulative "days on Carbon" that never goes backward. No shame copy; every quiet day names its fix.
4. **Trophy notifications (email to owner, CC info@carbon.ms, internal Slack #sales) fire on days 3 and 10 only**; day 5 is an in-app celebration with no notification. Addresses/channel env-configurable.
5. **First Win** ask = "your bread-and-butter product — a product you make all the time"; graceful ladder (rich draft → labeled placeholder shell → draft from the "what do you make" answer).
6. **Voice input**: microphone on the intake; transcripts persisted for Carbon's sales review (hard requirement).
7. **Hybrid AI intake**: 17 structured questions are the backbone; AI clarifies ("not sure — talk it through"), interprets uploads, drives conversational re-tune with confirm-before-apply.
8. **Re-runnable intake, zero data loss**: answers hide, never delete; re-tunes snapshotted; contradictions with confirmed decisions or observed product state raise a confirm card. Customer sees simplicity; versioning is internal.
9. **"Factories" never "shops"**; ICP is larger OEMs → Standard/Complex bands are the mainline experience.
10. **Stock-on-hand importer in Wave 2** (AI-first: count sheets → upload → AI transcribes → approve). Open-PO/open-SO importers AI-first in Wave 3.
11. **Existing enrolled companies get reset** onto the new template (build the reset in). The old 6-gate spine is retired for every tier, so the reset applies to all enrolled hubs (self-serve today in practice; Chase is in contact with all of them).
15. **No accounting-system connection is named anywhere in Load Your Data.** Every source (spreadsheets, named legacy ERP, QuickBooks, Xero, homegrown) gets step-by-step instructions for producing the exact data we need from them; imports run through the CSV/AI pipeline.
16. **Build straight through** — all four waves without pausing for review between them.
12. Locks preview Guided but commercial architecture is Chase's; all CTAs → existing Calendly booking flow (`SUPPORT_BOOKING_URL`). No readiness score in self-serve.
13. Authority order: **observed product state > confirmed decision > intake answer**.
14. Phases overlap; gates celebrate completion, never block.

## Current state (verified in code — reuse, don't rebuild)

- **Hub package** `packages/onboarding`: content templates (`src/content/*`, stable keys, `tiers?: Tier[]` scoping), pure logic (`src/logic/*`: `overlay.ts` effective statuses, `guide.ts` nextAction, `keys.ts`, `visibility.ts`, `timeline.ts`), server helpers (`src/server.ts`), zustand server-mirror UI (`src/ui/*`, `HubProvider`, `useHubActions`). `TEMPLATE_KEY="standard"`, `TEMPLATE_VERSION=1` in `src/content/index.ts`. EXTENDING.md documents the recipes; **no tests exist yet** despite vitest config.
- **Tables** (`20260624140312_implementation-hub.sql`): `implementationHub` (PK=companyId; templateKey/Version, tier, status, exclusions/contacts JSONB, signedAt/signedBy — signature columns exist but unused), `implementationCheckState` (UNIQUE(companyId,itemKey), kind enum), `implementationFieldValue`, `implementationRow` (collection+payload). All realtime-published; `useImplementationRealtime` revalidates.
- **Routes** `apps/erp/app/routes/x+/get-started+/`: `_layout.tsx` (loader, HubProvider, SETUP_SCREEN_PATHS deep links, internal PreviewBar + customer preview), `state.tsx` (single write action; `isInternalEmail` gates structural intents), `enroll.tsx` (self-enroll + admin email), page routes per `REGISTRY` slug. Home `x+/_index.tsx`: enroll card, hub summary, internal auto-redirect.
- **Spine today**: 6 steps; self-serve sees Configure/Train/Go-Live (`gate:configure`, `gate:train`, `gate:golive`); Discovery/Migrate/Acceptance are `tiers: ["guided","enterprise"]`. Detect signals: `detectImplementationSignals` (limit(1) probes: item, makeMethod, job, salesOrder, trackedEntity), overlay at read time, manual override wins.
- **Imports**: registry `apps/erp/app/modules/shared/imports.models.ts` (customer, customerContact, supplier, supplierContact, part/material/tool/fixture/consumable, bom, operations, workCenter, process; fixedAsset half-wired); wizard `apps/erp/app/components/ImportCSVModal/`; edge fn `packages/database/supabase/functions/import-csv/` (Kysely, idempotent via externalIntegrationMapping); AI column mapper `apps/erp/app/routes/api+/ai+/csv+/$table.columns.tsx` (Vercel AI SDK, `generateObject`, `openai("gpt-4o")`, deterministic exact-match first). **Missing importers**: stock on hand, open POs, open SOs, price lists, AR/AP, bulk users, quotes.
- **Inventory count feature EXISTS** (`inventoryCount`/`inventoryCountLine`, blind counting, CSV export, `post-inventory-count` edge fn booking variances via shared `post-adjustment` core) — the foundation for opening stock.
- **AI**: OpenAI only via Vercel AI SDK v5 (`generateObject`; gpt-4o/gpt-4o-mini). **Transcription edge function EXISTS** (`functions/transcription/`, `experimental_transcribe` + `gpt-4o-mini-transcribe`, base64 in → `{text, language}`) with **no frontend caller yet**.
- **Item/BOM creation**: `upsertPart` (+ auto-created itemCost/itemReplenishment/itemPlanning + makeMethod via triggers), `upsertMethodMaterial` (derives methodType/sourcingType from component), `upsertMethodOperation`(+Step/Param/Tool) in `apps/erp/app/modules/items/items.service.ts`; cost roll-up route `api+/items.$itemId.recalculate-cost.ts` (`calculateMadePartCosts`).
- **Email**: react-email templates in `packages/documents/src/email/` (`ImplementationHubEmail` exists); send via `trigger("send-email", {...})` → Inngest `sendEmailFunction` → Resend. Internal Slack: `getSlackClient().sendMessage({channel:"#leads"|"#sales"})` precedent in `packages/jobs/src/inngest/functions/tasks/onboard.ts`.
- **Cron precedent**: `packages/jobs/src/inngest/functions/scheduled/weekly.ts` (iterate companies, `fetchAllFromTable`, notify events), `dispatch.ts` (daily, timezone-aware via `@internationalized/date` using `location.timezone` — no company-level timezone exists).
- **Usage-signal tables**: `job` (status, completedDate), `purchaseOrder` (status transitions), `shipment`/`receipt`/`salesInvoice` (postingDate), `productionEvent` (startTime/employeeId/workCenterId), `quote`, `salesOrder`. No streak/activation/fleet/inactivity concept exists anywhere.
- **Tier** = `implementationHub.tier` (NOT the Stripe plan). Staff = `isInternalEmail` (`@carbon.ms`, `@carbon.us.org`). No cross-company fleet surface exists; internal-only route precedent exists.
- **Xero** sync can pull customers/suppliers (`ContactSyncer` + `accounting-backfill`); **QuickBooks is a dormant stub** (config only, `active: false`, no syncers).

## Architecture decisions

### A. Template v2 — the 7-phase spine for ALL tiers (`packages/onboarding/src/content/spine.ts`)

The SPINE becomes exactly these 7 StepDefs — no tier scoping on the steps themselves; stable keys never to be renamed:

| # | key | Customer-facing title | Gate ("it ends when…") |
|---|-----|----------------------|------------------------|
| 1 | `gate:intake` | Tell Us How You Run | Plan revealed; go-live date + owner set |
| 2 | `gate:basics` | Set Up the Basics | Tailored setup list done (auto-checked where visible) |
| 3 | `gate:load-data` | Load Your Data | Master data loaded + spot-checked |
| 4 | `gate:pilot` | Prove It Works | One real order traced end to end |
| 5 | `gate:crew` | Ready Your Team | Champions signed off; pilot floor station running |
| 6 | `gate:switch` | Make the Switch | Switch-day checklist complete; freeze plan signed |
| 7 | `gate:live` | Live on Carbon | 10 qualifying business days — Activated |

The old 6 gates (`gate:discovery`, `gate:configure`, `gate:migrate`, `gate:train`, `gate:acceptance`, `gate:golive`) are retired for every tier. Paid-tier-only work survives as tier-scoped **nested product steps** (net-new work + hosting nest under Set Up the Basics) and as the paid-only **pages** (Project Team, How We Work, Scope, Roles, Requirements), which stay in the registry. Tier differences now live in: page visibility, owner labels (`ownerForTier`), who fills the intake (staff-on-behalf for paid), and locks (self-serve-only surfaces). Bump `TEMPLATE_VERSION` to 2. `spineForTier`/`overlay`/`guide` need no structural change. New DetectSignals power auto-checks (see per-phase sections). Phase overlap = gates are independent; `nextAction` keeps pointing at the first incomplete gate but every phase page stays reachable. Content referencing old step keys (`board.ts` tasks' `stepKey`, `roles.ts`, gantt geometry) is remapped to the 7 new keys.

**Reset of existing hubs** (Chase-approved, all tiers): **lazy code reset, no SQL** — when the get-started loader finds a hub with `templateVersion < 2`, it (service-role) deletes that company's `implementationCheckState`/`implementationFieldValue`/`implementationRow` state, sets `templateVersion=2, status='tailoring'`, and the company starts fresh at Phase 1. Idempotent, runs once per company.

**New pages** (registry + copy + views + thin routes; existing paid pages untouched): `intake` (full-screen wizard, not a sidebar page), `load-data`, `pilot`, `crew`, `switch`, `live`. Setup Map + Training are shared but tailored. The retired `data` (paid Data Migration) page is replaced by `load-data` for all tiers; `go-live` page content folds into `switch` + `live`.

### B. Intake — data model + tailoring (Subsystem 1)

- **Storage: NO new tables.** The hub's sanctioned per-company state stores carry everything (EXTENDING.md's own extension recipe; RLS + realtime already configured; fully typed today):
  - Intake versions → `implementationRow` collection **`intake`** — payload `{version, answers, band, flags, status: 'draft'|'completed', completedAt}`. One row per version; latest completed row = current truth; a re-tune creates a new draft version, completed on confirm. Snapshots are just rows — history for free, diffing = pure comparison of two answer sets.
  - Transcripts → `implementationRow` collection **`intakeTranscript`** — payload `{intakeVersion, questionKey, source: 'voice'|'clarifier', transcript}`. **Sales-review requirement**: every voice utterance and clarifier exchange is persisted here.
  - (If a dedicated-tables hardening migration is ever wanted, it's a clean later step — but rows are the package's designed extension mechanism, not a workaround.)
- **Answer schema** in `packages/onboarding/src/content/intake.ts`: the 17 questions as typed content (key, ask, helper, options, skip logic, what-it-drives, flag conditions) + zod validator for the answers object. Copy uses "factory" language; Q-keys are stable (`q.product`, `q.people`, `q.sites`, `q.workIntake`, `q.customers`, `q.fulfillment`, `q.jobsPerMonth`, `q.tracking`, `q.quality`, `q.systems`, `q.books`, `q.items`, `q.boms`, `q.owner`, `q.goLiveDate`, `q.weeklyHours`, `q.upload`).
- **Tailoring logic** = pure `packages/onboarding/src/logic/tailor.ts`: `tailorPlan(answers, signals) → { band, suggestedWeeks, weeklyEffort, hidden: {setupKeys, pages, dataKeys}[each with reason MessageDescriptor], flags, receipts }`. Computed at read time from the latest completed intake — never stored, so it can't drift. Visibility overlay: setup/data/page filtering composes intake-derived hiding with staff exclusions (staff exclusions win). **Authority order** enforced here: a hide rule is suppressed when observed signals contradict it (e.g. accounting enabled + configured ⇒ don't hide accounting; surface a confirm card instead).
- **Re-tune diff** = pure `diffIntake(prev, next) → plain-language change list` ("2 steps added — you now track lots; date moved out a week"). Contradiction with a confirmed Decisions-Log entry or observed state → confirm card before the new version is marked completed.
- **Wizard UI**: `x+/get-started+/intake.tsx` full-screen flow (one question per screen, thumb-sized answers, progress bar, "Not sure" = recommended default + auto-logged decision-to-confirm). A `draft` intake row makes the wizard resumable mid-way; concurrent editors resolve last-completed-wins (single-owner flow in practice; note in code). **Voice**: MediaRecorder → base64 → `client.functions.invoke("transcription")` (per-question clips stay small) → answer prefill + transcript row. **Clarifier**: "Not sure — talk it through" opens an AI exchange (route `api+/ai+/intake.clarify.tsx`, `generateObject`: {clarifiedAnswer, followUpQuestion?}); exchanges persist as transcripts. **Payoff screen**: identity line, receipts, the clock, the 7-phase shape, one button → First Win. Complexity flags (per template §4) render the honest Guided aside with the booking CTA.
- RLS for the new tables follows the checkState pattern (any company employee reads/writes; DELETE gated) — completing the intake is a customer action.
- Enrollment flow change: enroll → redirect into the intake (Phase 1) instead of the command center; enrolled hubs with no completed intake route into the wizard (staff exempt).

### C. First Win — AI-drafted bread-and-butter part (Subsystem 3)

- Ask: "a product you make all the time" + optional upload (BOM export, item list, any spreadsheet).
- **Pipeline** (route-action orchestrated, streaming progress UI; each step idempotent): parse upload (PapaParse/sheet → rows) → `generateObject` #1: pick representative assembly + extract structure → `generateObject` #2: draft item + 2-3 level BOM + simple routing + prices with confidence per line → server inserts via existing services (`upsertPart`, `upsertMethodMaterial`, `upsertMethodOperation`) inside the graceful ladder: rich → full draft; thin → shell with clearly-labeled placeholder lines; unusable/skipped → draft from `q.product` text.
- **Pre-setup constraint**: First Win runs before work centers exist. Create one draft Process + Work Center (clearly named, tagged, with a modest default rate so the cost roll-up produces a number) proposed from intake answers — these seed Phase 2 rather than fight it. Component/raw-material lines are created as tagged draft items.
- **Idempotency**: the drafted item's id is stored (`firstWin.itemId` fieldValue); re-entering the flow shows the existing draft instead of drafting twice. Progress UI is staged ("Reading your file… drafting your part… costing it…") over sequential server steps.
- **Draft labeling**: item `tags: ["ai-draft"]` + placeholder BOM lines named as drafts; makeMethod stays Draft status. Nothing silently commits — the review screen frames everything as "our draft of your part — fix what's wrong."
- **"Fix three things"**: material? minutes? price? — three inline edits on the drafted part, then cost roll-up via the existing recalculate route. **"Run it as a job"** (optional): create a job from the item (existing job creation + `get-method` itemToJob), landing on schedule + MES view.
- Failure modes handled: unparseable file (fall to text draft), AI garbage (zod-validated, retry once, fall down ladder), duplicate readableId (suffix), no upload (text draft).
- (Final design details reconciled with the Plan-agent output — see build tasks.)

### D. Streak engine + scoreboard (Subsystem 2)

- **Storage: NO new tables.** Usage days → `implementationRow` collection **`usageDay`** — payload `{date (company-local ISO), signals (per-area counts), qualifying, freezeApplied}`; uniqueness per (companyId, date) enforced by the single-writer cron's upsert-by-lookup. Streak state → `implementationFieldValue` keys **`live.liveAt`, `live.activatedAt`, `live.streak`, `live.streakBest`, `live.daysOnCarbon`, `live.freezesRemaining`** (single writer: the cron + gate transition).
- **Hourly Inngest cron** (`packages/jobs/.../scheduled/implementation-usage.ts`): for each hub past cutover (`liveAt` set), when the company's local business day has just closed (timezone from primary `location.timezone`, fallback UTC — the `dispatch.ts` pattern), recompute the last two local days' usage rows (late-arriving data heals) and upsert by (companyId, date). Business day = Mon–Fri minus company `holiday` rows (existing table, same check `dispatch.ts` uses). Qualifying day = meaningful actions in ≥2 in-scope areas (thresholds scaled by `q.jobsPerMonth` band); signals from `job.completedDate`, PO status transitions, `shipment`/`receipt`/`salesInvoice.postingDate`, `productionEvent`, `quote`/`salesOrder` created. Late data can flip a day to qualifying on recompute but **never un-qualifies** a counted day (never-backward rule).
- **Streak reducer** = pure function in `packages/onboarding/src/logic/streak.ts` (unit-tested): folds the company's full `usageDay` history from `live.liveAt` forward on every run (recompute-from-scratch, ≤ ~60 rows — no incremental drift) and writes the derived streak fieldValues. Quiet business day → consume a freeze if available (freezeApplied, streak survives) else streak resets to 0 — but `daysOnCarbon` only climbs and milestones already reached stay celebrated. Milestones at 3/5/10 fire exactly once (guarded by checkState keys `check:live.milestone.{3,5,10}`): all three celebrate in-app with confetti; **days 3 and 10 only** also send the trophy email (new `StreakMilestoneEmail` template; to owner, CC `CARBON_TEAM_EMAIL` env, default info@carbon.ms) + internal Slack ping (`CARBON_TEAM_SLACK_CHANNEL` env, default #sales). Day 10 → `live.activatedAt` set, biggest celebration, closing screen (journey-in-numbers + "what you set aside on purpose" menu from Later/deferred items), hub status → complete.
- **Scoreboard UI** (`live` page + hub header between cutover and activation only): streak + freezes + days-on-Carbon + printed plain-words definition; "This week in your factory" counts (this vs last week); **daily health check** list computed in the loader (jobs idle 2+ days, negative stock, orders past promise not shipped, POs past due not received — each row deep-links via `path.to`); weekly relapse question (one click; a "yes" creates a fix-it task row).
- **After activation**: cron keeps writing usage days (internal reliance tracking, feeds fleet view + future relapse outreach); no customer-facing surface.

### E. Load Your Data (Phase 3) + importers

- The **"Load Your Data"** page (all tiers) — checklist auto-built from intake in dependency order (customers → suppliers → items → BOMs/routings → pricing where applicable), each row: a per-source **step-by-step recipe** (content keyed by `q.systems`; per Chase, NO accounting connection is named anywhere — every source, including QuickBooks/Xero, gets plain instructions for exporting/producing exactly the data we need, then the CSV/AI import does the rest), import launcher (deep link to the entity screen's existing Bulk Import), live momentum counts (new `getImplementationCounts` server fn), **spot-check flow** (deal 5 random imported records, links, "do they look right?" → mark loaded), import-with-judgment copy (active-only recommendation). Greyed switch-week rows visible from day one.
- **Stock-on-hand importer (Wave 2)**: AI-first surface built ON the existing inventory count: print count sheets (existing CSV export/blind count), then upload filled sheets/CSV/photos → `generateObject` parses to count lines → creates an `inventoryCount` for review → post books opening stock through the existing `post-inventory-count` machinery. Handles lots/serials via count-line attributes.
- **Open-PO / open-SO importers (Wave 3)**: paste/upload/PDF → AI extraction → Draft purchase/sales orders for approval (existing order services); prioritized by expected receipt/due date. Price lists + bulk operators: same AI-first pattern, smaller scope.

### F. Prove It Works (Phase 4)

Pilot picker (a real, recently completed bread-and-butter order; pre-suggest the First Win part) stored via customer-owned field (`pilot.salesOrderId` etc. — **requires honoring `FieldDef.ownership` server-side** in `state.tsx`, today hardcoded isInternal). The **trace**: new server fn `getPilotTrace` walks the document chain from the pilot sales order (quote → SO → job → PO → receipt → issue → floor event → complete → shipment → invoice), each line self-checks as the document appears; flavor (quote-first? MRP walkthrough? serialized lap) from intake answers. Lap two ("your gnarliest one") recommended for standard/complex. Graduation-run (one-order parallel) as content + checklist. PO/invoice are previewed, never sent.

### G. Ready Your Team (Phase 5)

**Your Crew**: new collection `crew` (area, name, email, status invited/in-progress/signed-off) — customer-editable (extend collection write rules: per-collection customer-add allowed). Champion path per area: watch (existing training tracks trimmed to scope) → do (5 real tasks on their data, content per area) → sign off (checkState per area). Owner sees the crew grid fill. **Floor rollout**: hardware checklist generated from setup (tablet/kiosk, printer if labeling, scanner if barcoding, wifi reach), operator access (MES PIN console — verify any operator can be clocked in within 30 seconds), one pilot station with 3+ jobs through the shop-floor app (auto-checked: `productionEvent` count at the pilot work center — new detect signal), paper travelers keep printing from Carbon, wave-by-wave spread sized by intake (mostly post-go-live; full floor coverage is NOT a go-live blocker).

### H. Make the Switch (Phase 6)

Date confirmation with guidance (books moving → first of month; else any Monday; never busiest season); **push-the-date dialog** (asks why, stores reason — gentle friction). T-minus plan auto-laid-out from the date: T-7 enter/import open POs + SOs (honest hour estimates until Wave-3 importers), weekend stock count (wired to the Wave-2 count flow; top-movers guidance for standard/complex), T-1 **Old-System Freeze Plan** — a form the owner signs with typed name + date (persists via fieldValues + the existing unused `signedAt`/`signedBy` columns): systems named, freeze moment, archive location, read-only access + 90-day removal, day-one rule in their words, cancellation date for legacy-ERP factories. Switch day: existing six-step cutover checklist + the go/no-go huddle (4 questions). Completing the gate sets `liveAt` (starts the streak) with the biggest celebration so far.

### I. Always-on layer

- **Countdown** in the hub header from the go-live date (existing timeline fieldKeys); moves only through the push-the-date dialog.
- **Monday digest** (Inngest cron, `weekly.ts` pattern): email to owner (champions join in Phase 5): streak or phase, 2-3 things this week with time totals, one click into the next step. New `HubDigestEmail` template, coworker tone.
- **Quiet detection** (daily cron): last hub activity = max across checkStates/fieldValues/intake + usage days. 7 quiet days → nudge email naming the actual next step and its cost (new `HubNudgeEmail`); 14 days → internal Slack ping (booking CTA is also surfaced — a Guided moment). Last-nudge marker prevents repeats.
- **Receipts**: every intake-hidden item explains itself in one line tied to the customer's own answer, wherever it would have appeared.
- **Celebrations at every gate**: reuse the existing confetti pattern; per-gate summary worth forwarding.

### J. Growth layer (Wave 4)

- **Locked previews**: paid pages (Your Project Team, How We Work, Requirements, Risk-register-style surfaces) render for self-serve as real-but-dimmed previews with one booking CTA (registry gains `lockedPreviewFor?: Tier[]`; sidebar shows the lock).
- **Moment cards**: Load Your Data top-of-checklist ("Have us do this part"), Ready Your Team (live training), switch week (on-call), stall-triggered anywhere (14-day stall on a step → the "hand it to us" card). All CTA → `SUPPORT_BOOKING_URL`.
- **Fleet view**: internal-only route (server `isInternal` gate + service-role aggregate): every enrolled factory's phase, band, flags, last activity, streak, nudge state. This is where post-activation reliance dips surface for human outreach.
- **Upgrade source tagging**: booking-CTA clicks record their originating surface (PostHog event + fieldValue), so upgrades can be attributed and stall-born clicks name the next friction to automate.

## Implementation waves (build order)

Waves are built **straight through** (Chase's call), committing per completed chunk. Each wave ends: scoped typecheck + vitest + lingui extract + commit. **No SQL migrations anywhere** (row/fieldValue storage) — nothing to apply, types are already current. All new customer copy via Lingui `msg`, "factory" vocabulary. NOTE (environment): this container has no local DB/Docker, so browser verification and the Inngest dev loop are deferred to Chase's environment; the compensating rigor is unit tests on all pure logic + full scoped typechecks.

### Wave 1 — The funnel (intake, tailoring, First Win, Day One)
1. **State layer**: intake/transcript collections + streak fieldValue keys + zod validators in `packages/onboarding/src/models.ts`; lazy v1→v2 hub reset in the get-started loader (service-role, idempotent).
2. **Template v2**: the 7-phase spine (all tiers) + retire old gates + remap board/roles/gantt content; new registry pages (`intake`, `load-data`, `pilot`, `crew`, `switch`, `live`) + copy; `TEMPLATE_VERSION=2`; new board tasks per phase.
3. **Intake content + logic**: `content/intake.ts` (17 questions, flags, skip logic), `logic/tailor.ts` + `logic/diffIntake.ts` (pure, unit-tested — the package's first tests), server helpers (`getIntake`, `upsertIntakeDraft`, `completeIntake`, `insertTranscript`).
4. **Wizard UI + payoff**: full-screen intake flow (voice via transcription edge fn; clarifier via new `api+/ai+/intake.clarify.tsx`; upload dropzone), payoff screen (receipts/clock/shape/flags-aside/one button), enrollment redirects into Phase 1, countdown header, re-tune entry ("Retune my plan") with diff + confirm cards.
5. **Tailored Setup Map**: apply `tailorPlan` hiding + receipts to setup groups/rows + Required/Recommended/Later chips + time chips (new content fields), Later items auto-collect into the Phase-2 backlog list. Decisions Log cards (5 decisions, `implementationRow` collection `decisions`, "Decided by X on Y · change").
6. **First Win**: pipeline route + progress UI + draft insertion via items services + draft process/work-center seeding + "fix three things" + cost roll-up + optional "Run it as a job" + day-7 nudge referencing the part by name (nudge itself lands in Wave 3; the copy hook is built here).
7. Home page: enroll card copy refresh; hub summary reflects 7 phases.

### Wave 2 — The spine (data, pilot, switch)
1. **Load Your Data v2**: page + per-source recipes content + import deep links + momentum counts (`getImplementationCounts`) + spot-check flow + import-with-judgment copy + greyed switch-week rows.
2. **Stock-on-hand importer**: count-sheet print flow + AI-parsed upload → draft `inventoryCount` → review → post (opening stock). New route(s) + `generateObject` schema + wiring into switch-week row.
3. **Prove It Works**: pilot picker (customer-owned fields — implement `FieldDef.ownership` honoring in `state.tsx`), `getPilotTrace` server fn + self-verifying trace UI + lap-two prompt + graduation-run content + celebration.
4. **Make the Switch**: T-minus plan, freeze-plan form + typed signature (`signedAt`/`signedBy`), go/no-go huddle, cutover checklist reuse, `liveAt` set on gate completion, celebration + reframing line.
5. **Scoreboard v1**: `live` page with this-week counts + manual streak display (engine lands in Wave 3) so switched factories see the finish line immediately.

### Wave 3 — Friction removers (engine, digests, importers)
1. **Streak engine**: `usageDay` rows + cron + pure streak reducer (tests: freeze consumption, reset, milestone idempotency, timezone edges) + milestones + trophy emails at days 3/10 only (`StreakMilestoneEmail`, CC Carbon team) + internal Slack pings + activation close flow (journey-in-numbers + deferred menu + status complete) + post-activation internal tracking.
2. **Health checks**: loader queries (idle jobs, negative stock, past-promise orders, past-due POs) + deep links + relapse question → fix-it tasks.
3. **Monday digest + quiet detection**: two Inngest crons + `HubDigestEmail`/`HubNudgeEmail` templates + last-activity computation + no-repeat guards.
4. **Open-PO/open-SO AI importers** + price-list import + bulk operator creation (AI-first pattern from Wave 2).

### Wave 4 — Growth layer
1. **Locked previews** (`lockedPreviewFor` on registry + dimmed render + booking CTA) + **moment cards** + **stall-triggered card**.
2. **Fleet view** (internal-only route, service-role aggregation: phase/band/flags/last activity/streak/nudges).
3. **Upgrade source tagging** (PostHog + fieldValue on booking-CTA clicks).

### Cross-cutting (every wave)
- `path.to` additions for new routes; `SETUP_SCREEN_PATHS` extensions; AGENTS.md + `.claude/rules` sync (keep-sources-in-sync); EXTENDING.md updates for new recipes; copy in `content/copy.ts`; lingui extract + /translate.

## Verification

- **Unit**: first-ever tests in `packages/onboarding` — `tailorPlan` (answers→hiding/receipts/band matrix), `diffIntake`, streak reducer (freeze/reset/milestone/timezone), trace derivation. `pnpm --filter @carbon/onboarding test`.
- **Types**: `pnpm exec turbo run typecheck --filter=@carbon/onboarding --filter=erp --filter=@carbon/jobs` (no migrations → no type regeneration needed).
- **Browser (deferred to an environment with a running stack)**: /auth + /test flows — W1: enroll → intake (incl. voice + skip + payoff receipts) → First Win → commitments → re-tune diff; W2: recipes → import → spot-check → pilot trace self-checking → freeze plan sign → liveAt; W3: simulate usage days → streak/freeze/milestone → activation close; W4: locked previews + fleet view.
- **Jobs**: Inngest dev server for cron functions; DISABLE_RESEND for email dry-runs; email previews via `pnpm --filter @carbon/documents email:previews`.

## Decisions from Chase's final review (2026-07-22)

1. The 7-phase journey applies to ALL tiers; Carbon staff can complete the intake on a paid customer's behalf.
2. No accounting-system connection named in Load Your Data — step-by-step data-production instructions per source instead.
3. Build straight through, no pauses between waves.
4. Trophy notifications (email CC info@carbon.ms + Slack #sales, env-configurable) at days 3 and 10 only; day 5 celebrates in-app only.
