paths:
  - "apps/erp/app/modules/resources/learn/**"
  - "apps/erp/app/modules/resources/ui/Learn/**"
  - "apps/erp/app/routes/x+/learn+/**"
  - "apps/erp/app/routes/x+/resources+/learn*.tsx"
  - "apps/erp/app/routes/share+/certificate.$code.tsx"
  - "apps/erp/app/routes/file+/learn-certificate+/**"
  - "packages/documents/src/pdf/LearnCertificatePDF.tsx"

# Carbon Learn

Role-based learning tracks built on the docs: read → scenario quiz or verified
hands-on challenge → certification exam → a version-stamped certificate with a
public verification URL. Spec: `.ai/specs/2026-08-29-learning-paths-certification.md`.

Everything is an **additive extension of the `resources` module** — no new
permission family (`.ai/lessons.md`: "Features live inside existing permission
modules"), no changes to the existing `training*` tables.

## The shape

Nine tracks ship live: `fundamentals` plus one per role (`purchasing`,
`accounting`, `sales`, `inventory`, `production`, `planning`, `quality`,
`admin`). 780 questions and 24 verified challenges.

| Piece | Where | Note |
|---|---|---|
| Curriculum (client-safe) | `learn/tracks/<slug>.ts` | one file per track; `curriculum.ts` assembles them and owns every lookup helper |
| Shared shapes | `learn/types.ts`, `docs.ts` | tracks → modules → units; one assessment per unit |
| Constants + pure rules | `learn/gamify.ts` | every number lives here; unit-tested |
| Question banks | `learn/banks/*.server.ts` | **server only** — answers must never ship |
| Challenge checkers | `learn/checkers/*.server.ts` | read-only assertions over a `LearnReader`; `shared.server.ts` holds `CheckerContext` + `fail` |
| Engine | `learn/engine.server.ts` | the only writer of progress, XP, and certificates |
| Admin projection | `learn/projection.ts` | pure; status + certificate only |

## Invariants

- **Grading is server-side and version-bound.** Every answer is graded at
  submission against the bank for `attempt.contentVersion` and written to
  `learnAttemptAnswer`; finalize only sums. If `LEARN_CONTENT_VERSION` has moved
  on, the attempt is **voided** (`voidedAt`, no score, no cooldown) rather than
  graded against questions the learner never saw. Bump `LEARN_CONTENT_VERSION`
  on ANY bank, checker, or track-structure change.
- **XP is an append-only ledger.** `learnXpEvent` has a unique index on
  `(userId, companyId, kind, refSlug)`; `awardXp` inserts with `DO NOTHING`, so
  a retry can never inflate a total and a mis-award is a deletable row. Totals
  are always `SUM`s — never a mutable counter column.
- **A challenge's clock is the server's.** `startChallenge` writes `startedAt`;
  `checkChallenge` takes only an `attemptId` and re-reads the row under the
  session's `companyId` (a foreign id is a 404). The client never supplies a
  time or a company.
- **Certificate issuance is idempotent** on `(examAttemptId, companyId)` and
  re-verifies the exam and every required challenge INSIDE its transaction. It
  snapshots `challengeAttemptIds` + `evidence`, so re-running a challenge later
  cannot change what a certificate was issued on.
- **Writes never come from the client.** Engine tables carry SELECT policies
  only (self + company membership) and no INSERT/UPDATE/DELETE policies at all;
  `learnAttemptAnswer` has RLS enabled with **no policies** — service-role only.
  Precedent: `itarCertification`.
- **Managers see a projection.** `getLearnTeamStatus` returns status, percent,
  and certificate state. XP, streaks, activity, and per-question results are the
  learner's alone. Do not add them to an admin surface.

## Gotchas that already bit

- **`toIso` is needed on EVERY Kysely-read timestamp, not just the one that
  bit first.** Four sites need it: the challenge scope's `startedAt`, the exam's
  `expiresAt` (a `Date` compared against an ISO string never expires the
  sitting), each failed attempt's `submittedAt` (default `sort()` on `Date`
  objects orders by weekday NAME, so the cooldown anchors to the wrong attempt),
  and a certificate's `expiresAt` (`parseAbsolute` throws on a non-string, so a
  passed renewal silently extends nothing).
- **A voided attempt must be refused in `finalizeExamAttempt` too.** Guarding
  only `!attempt` lets a voided sitting reach the scoring path and mint a
  certificate stamped with the CURRENT content version off answers graded
  against a retired bank.
- **`learnAssignment` is the one client-writable Learn table**, and its RLS can
  only see `companyId` — not what is inside `groupIds`. The
  `learnAssignment_groups_in_company` trigger is what stops a PostgREST write
  naming another company's group, which the dashboard would then resolve members
  for. `upsertLearnAssignment` still validates (it gives a readable error); the
  trigger is the backstop for when the service is not in the path.
- **A challenge must never pass somebody on a colleague's work.**
  `suppliersCreatedSince` falls back only to rows with NO recorded author —
  never to one demonstrably created by a different user. `countGrantedPermissions`
  counts only grants naming this company (or the `"0"` wildcard).
- **The question report's five-attempt floor lives in the SERVICE**, not the
  route: `getLearnQuestionStats` is also exposed as an MCP tool, and a
  route-level filter leaves that path unguarded.
- **Normalise DB timestamps before a PostgREST filter.** Kysely decodes
  `timestamptz` to a JS `Date`; `String(date)` is the runtime-local format and
  Postgres rejects it (`time zone "gmt+0530" not recognized`). Use `toIso()`.
  Works on a UTC machine, fails everywhere else — see `.ai/lessons.md`.
- **Never swallow a reader error into `[]`.** A failed query and "the learner
  hasn't done the work" must be distinguishable; `reader.server.ts` logs via
  `empty(context, error)`.
- **`ui/Learn/**` must not import `~/modules/resources`.** The barrel re-exports
  `./ui`, so that is a cycle and SSR dies with "element type is invalid". Import
  the sibling directly (`../../learn`, `../../../resources.models`).
- **`purchaseOrderLine.purchaseOrderId` is the PO's UUID**, while
  `purchaseOrder.purchaseOrderId` is the readable `PO000028`. Join on the UUID.
- **PO status is computed from lines** by the post-receipt/post-invoice edge
  functions — assert membership in the released set, never one exact value.
- Flat-routes: `$trackSlug.tsx` would make `$trackSlug.$unitSlug.tsx` a CHILD.
  The track page is `$trackSlug._index.tsx` so the unit route is a sibling.
  Same trap on the admin side: `learn.tsx` renders an `<Outlet>` for its
  drawers, so the question report is `learn-questions.tsx` — a sibling — rather
  than `learn.questions.tsx`, which would stack it under the team table.
- **`salesOrder` has NO `quoteId` column.** The only link conversion preserves
  is `opportunityId`, which both tables carry. Same shape of trap as the PO one
  above: matching on the obvious name silently matches nothing.
- **`accountingPeriod.status` is `Active | Inactive`** — the close state is a
  DIFFERENT column, `closeStatus` (`Open | Locked | Closed`).
- `employeeType` has no `createdBy` and `employeeTypePermission` has no
  `companyId`. The admin checkers scope on company + `since`, and on ids that
  were already company-scoped, because those are the only columns there are.

## The checker proving rule

Every checker ships with tests that prove it **fails on an empty company** and
**passes on a known-good sequence**, plus that the first failing requirement is
named and that the scope (`userId`, `since`) is honoured. A challenge that
cannot fail verifies nothing. See `checkers/checkers.test.ts`.

## Adding a track

1. Add `tracks/<slug>.ts` with `status: "live"` and register it in the
   `learnTracks` array in `curriculum.ts`.
2. Add `banks/<track>.server.ts` — per-topic pools ≥ 3× the exam blueprint,
   ≥ 8 questions per quiz unit, ≤ 40% `remember`, every `docsUrl` resolving to a
   real file. `banks.test.ts` enforces all of it.
3. Add `checkers/<track>.server.ts` + reader methods + proving tests.
4. Bump `LEARN_CONTENT_VERSION`.

## Docs-side quizzes

`docs/components/quiz.tsx` is the anonymous, localStorage-only version for the
documentation site — no auth, no backend, nothing leaves the browser. Its answer
key lives in attributes (invisible to the search index) and
`scripts/generate-agent-kb.ts` drops `<Quiz>` blocks entirely so the agent is
never taught the distractors.
