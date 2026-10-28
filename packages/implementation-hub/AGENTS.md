# @carbon/implementation-hub

Implementation Hub, Personal Pages layout — onboarding blueprint, pure logic, server DB helpers, and presentational UI for company setup. The hub is one page per person: Carbon staff define each person's page in a JSON page file (`implementationMember`); a person without one sees an empty hub. See `EXTENDING.md`.

## Two layouts

- Carbon has two Implementation Hub layouts. `implementationHub.layout` (`implementationLayout`: `Company Plan`, `Personal Pages`) holds the one a company uses; the default is `Company Plan`, so every company enrolled before the column existed, and every company that enrolls itself, keeps it.
- Company Plan is the hub's 18 pages and sidebar: `@carbon/onboarding` and the ERP's `x+/get-started+/` routes. Keep both exactly as they are; this package never imports them.
- Personal Pages is this package and the ERP's `x+/implementation+/` routes. The layout route's `handle.sidebar` (`ImplementationSidebar`) links them: Pages (My Page for a customer), and for Carbon staff the hub's Settings page (enrolment and layout).
- Which hub a company gets is decided in one place: `usesPersonalPages(hub)` in the ERP's `modules/shared/shared.models.ts`. The nav item, the home card, the app shell's signals, the Personal Pages layout's redirect, the Settings page and the `/state` write guard all call it. A per-company rollout rule replaces it there.
- Both layouts read the same hub tables. A card ticks the same state key, with the same value, as the item's Company Plan page. So that a Company Plan company keeps exactly the hub it had, the `/x/implementation/state` action refuses every write the Company Plan hub reads (`changesCompanyPlanHub`, `logic/access.ts`) until the company uses Personal Pages; page files and assignments are written before a switch.
- Only Carbon staff (an internal email) with `update: "settings"` change the layout: the unpublished `setImplementationLayout` service function, from the hub's Settings page (`x+/implementation+/settings.tsx`, posting to `layout.tsx`). Enrolling from that page starts the company on Personal Pages.
- Routing: the Personal Pages layout sends the company's own people of a Company Plan company to `/x/get-started`. Staff reach Personal Pages in any company by its URL, to load pages before a switch and to reach Settings. The nav item follows the layout; the home page's summary card shows for Company Plan only. `/x/get-started` itself is unchanged, so a Personal Pages company's people can still open it by URL.

## Always

- **Use the three-export structure**: `@carbon/implementation-hub` (logic + types), `@carbon/implementation-hub/server` (DB helpers), `@carbon/implementation-hub/ui` (React components)
- **Follow Carbon service convention** — server functions take supabase client as first arg, return `{ data, error }` (never throw)
- **Keep logic pure and client-safe** — `src/logic/` contains visibility, timeline, board, guide, and overlay logic with no server deps
- **Use zustand for UI state** — `hubStore` manages the Implementation Hub's client-side state via `HubProvider`

## Ask First

- Modifying the `TEMPLATE_KEY` or `TEMPLATE_VERSION` constants (affects enrolled companies)
- Adding new DB tables or columns (needs migration + RLS)
- Changing the onboarding step ordering or visibility logic

## Never

- Import server-only modules (`@supabase/supabase-js`, DB client) from the client-safe barrel export
- Hardcode company-specific setup steps — use the template/content system

## Validation Commands

```bash
pnpm --filter @carbon/implementation-hub test        # vitest
pnpm --filter @carbon/implementation-hub typecheck   # tsc --noEmit
```

## Key Patterns

- **Content-driven**: `src/content/` defines the template blueprint (steps, sections, exclusions)
- **Template version 2**: `TEMPLATE_VERSION` (`src/content/index.ts`) is 2. Nothing completes from detected data: a person ticks every step, nested product steps included. Detection signals and setup counts are evidence only. Companies are enrolled by `@carbon/onboarding` (version 1); this package's `enrollImplementation` is not called by the ERP
- **Single write path**: `applyHubMutation(client, actor, action)` (`src/apply-mutation.ts`, exported from `@carbon/implementation-hub/server`) runs every hub mutation. The ERP's `/x/implementation/state` action calls it. The access decision is the pure `refusalFor(actor, action, row)`; RLS is the backstop. Each tick records `actor.source` (`customer`, `staff`, `mcp`) and clears its verification
- **Evidence**: `getSetupCounts(client, companyId)` (server) runs one head count per `ONBOARDING_COUNT_KEYS` entry (`src/logic/status.ts`); a failed read is null and listed in `unavailable`, never zero. `src/content/evidence.ts` maps Setup Map rows (`SETUP_ROW_EVIDENCE`) and nested product steps (`PRODUCT_STEP_EVIDENCE`) to count keys; views read `useCounts()` and render `EvidenceCount`. Evidence never completes a step. The ERP caches the counts in redis (`getImplementationCounts`, `shared.service.ts`); `getHubStatus` returns progress and counts in one read
- **Access and enrolment**: `hubAccess(enrolled, isInternal)` (`logic/access.ts`) is the one rule. Carbon staff (`isInternalEmail`) reach the hub in every company they belong to, enrolled or not, and opening it creates nothing; the ERP's `x+/implementation+/_layout.tsx` gives an unenrolled hub the settings enrolment would create (`UNENROLLED_HUB`); staff open it by its URL until the company is enrolled. The company's own people reach the hub only once the company is enrolled (an `implementationHub` row): enrolment is when the hub becomes visible to them. Staff enrol from the hub's Settings page (Enroll company), which posts to `x+/implementation+/enroll.tsx` (staff need no settings permission there; everyone else needs `update: "settings"`). The hub tables reference `company`, not `implementationHub`, so pages are written before enrolment; every other write waits for a Personal Pages hub (see Two layouts)
- **Per-person pages**: `implementationMember` holds one page file per person (`memberPageValidator`, `models.ts`). `logic/page.ts` builds the catalogue of placeable hub items (`buildPageCatalogue`), checks a page (`checkMemberPage`: schema, unknown items, duplicates) and resolves its cards (`resolveMemberPage`, `cardState`, `pageProgress`). A card placing a hub item ticks that item's existing state key; a custom card ticks `customCardKey(userId, key)`. Writes are the `setMemberPage` / `deleteMemberPage` intents, Carbon staff only. `ui/MemberPageView.tsx` renders the page; the ERP's `x+/implementation+/_index.tsx` adds the staff bar (view as, load, export, catalogue, remove). Its person picker lists everyone in the company, with their `employees` status (Active, Invited, Inactive; inactive sorts last and is muted), in three groups from `groupHubPeople`: Carbon users (by email, with or without a page), configured users (a page) and unconfigured users (no page); choosing someone without a page offers Set up page, which opens the load modal with `starterMemberPage` for them. The picker reads people through a `bypassRls` client, like the Employees screen: invites have no read policy, so the `employees` view reports an invited person as Inactive to the signed-in client. Anyone in the company can be given a page, whatever their status: an invited person's waits for their first sign-in, an inactive person's for a new invite. `setMemberPage` requires only that the person is an employee of the company. **Questions**: a page's question cards show as one numbered list above its sections (`splitPageQuestions`, `ui/PageQuestions.tsx`), in page order; a section left with no cards is dropped, and page progress still counts the questions. A question row may list `options` (and `multiple`): the list shows choice cards with Not sure (`QUESTION_NOT_SURE`, stored `?`, shown as a grey Not sure badge while the question stays open), otherwise a typed answer in a field that grows with its text. Answering is the `answerQuestion` intent (`logic/question.ts`: `answerQuestionPayload` checks the choices against the options): one write saves the answer and sets `check:question.<rowId>` to answered when there is a typed answer or a chosen option other than Not sure, and back to open otherwise; the hub store shows it at once (`optimisticAnswers`, released by `withPendingAnswers`). A card draws its lower panel only when it has something in it, and the row's source (`SourceBadge`: AI agent, handover, interview) shows to Carbon staff only
- **Assignments**: one assignee per hub item in `implementationAssignment`, keyed by the item's status key: `task:<key>`, `flag:setup.<key or row id>`, or `row:<row id>` for a custom row (`rowItemKey`). Written by the `setAssignee` intent and read by `getHubStatus`; the per-person page shows none
- **Tests and the Lingui macro**: content modules mark copy with `msg` from `@lingui/core/macro`, a compile-time transform vitest does not run. `vitest.config.ts` aliases it to `test/lingui-macro.ts`, which builds the same `MessageDescriptor` with the source text as `message`, so tests import real content and assert on `descriptor.message`
- **Logic layer**: `src/logic/` — pure functions for visibility, timeline, board layout, guide flow, readiness (`planTasks`: the one task list every view counts progress from), the overdue cascade (`cascade.ts`, walking `content/dependencies.ts`), and `buildHubPlan` (`hub-plan.ts`, the plan `getHubStatus` returns)
- **UI primitives**: `src/ui/primitives/` — `PageHeader`, `StatusToggle`, `EditableInput`, `EvidenceCount` / `VerifiedBadge` / `SourceBadge` (`HubEvidence.tsx`), `LearnLink`, and the status tokens
- **Views**: `MemberPageView` and `MemberPageEmpty` (the hub), `OnboardingHubSummary` (the ERP home card). The 18 pages the per-person page replaced are recorded, with their user stories, outside the repo

## Cross-References

- `packages/database/` — `implementationHub`, `implementationCheckState`, `implementationFieldValue`, `implementationRow`, `implementationAssignment`, `implementationMember` tables
- `packages/form/` — form primitives used by onboarding UI
- `packages/react/` — shared React components
