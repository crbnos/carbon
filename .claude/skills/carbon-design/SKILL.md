---
name: carbon-design
description: >-
  Carbon's design language — the principles, page archetypes, components, states, copy rules
  and anti-patterns that make UI look and behave like the rest of Carbon (ERP + MES). Use
  whenever designing, building, restyling or reviewing any user-facing UI in apps/erp, apps/mes,
  packages/react or packages/form: a new page, module, feature, component, table, form, drawer
  or modal, dashboard, settings screen, empty/loading/error state, status, or shop-floor screen
  — and whenever someone says a screen "doesn't feel like Carbon", looks off, is inconsistent,
  or needs a design pass or UI review. Trigger even when the request is framed as a feature
  ("add X to Y") that will need new UI. Prefer this over generic UI/design/frontend skills in
  this repo. Not for the docs site (use carbon-docs) or backend-only work.
---

# carbon-design — the design DNA of Carbon

Carbon has a consistent, largely unwritten design language. Features built without it
"work" but feel generic. This skill encodes that language so anything you design — including
things Carbon has never had — looks and behaves as if the same team made it.

**Announce at start:** "Using the carbon-design skill — designing {feature} in Carbon's language."

It is **not** a component catalog. Components are one part. The skill teaches *why* Carbon
makes each choice, so you can make the right choice where no component or precedent exists:

> Reuse existing patterns when they fit. Extend the design system when necessary.
> Never force an existing component into a use case where it doesn't belong.

## The Carbon feel in one paragraph

A calm, dense, monochrome working tool for manufacturers who live in it all day. Color is spent
only on meaning (status, type, overdue/negative, charts). Every record is identified by a
readable ID that is visible, copyable and linked. Records are state machines: the status pill
sits next to the ID and the next step is the one primary button. Documents open into a fixed
workspace — header strip, structure on the left, work in the middle, metadata on the right.
State lives in the URL. Secondary things hide in known places (⋯ menu, Properties panel,
hidden columns, row menus), never behind modes. Permissions and locks disable in place.
Everything is keyboard-reachable, translated, and honest about its state. And it is **worked
on**, not looked at: every value a user may need to change is changeable right where it is
shown (a line opens into its editable form, a header fact autosaves in Properties, the next
status is one click), guarded by the record's lock. On the shop floor the same language gets
bigger, simpler and touch-first.

## The 13 laws (short form — the reasoning is in `references/principles.md`)

1. **Quiet chrome, loud data.** Tokens only; hue only for meaning; ink primary; no colored prose.
2. **Identity first.** Readable IDs / thumbnails / avatars — visible, copyable, linked. No raw ids.
3. **Lifecycle drives the UI.** `Status` next to the ID; exactly one primary = the next step; status locks in place.
4. **Structure left, work center, metadata right.** The 3-pane document workspace.
5. **The URL is the state.** Route tabs, route drawers, search-param filters.
6. **One component per concept.** Same thing, same look, everywhere (status maps, DateTime, Enumerable, icon vocabulary).
7. **Match the nearest sibling** before inventing anything.
8. **Hide in known places, never in modes.** ⋯ menu, Properties, hidden columns, row menu.
9. **Disable, don't hide** for permissions and locks.
10. **Dense, not cramped.** `text-sm` body, `text-xs` muted labels, h-8 buttons, 4/8/16 spacing, `font-medium`.
11. **Primitives own the surface.** `Card > CardContent`, no double edges, `rounded-lg` inner boxes, no big shadows.
12. **Honest, grounded, translated, keyboard-first.** Real states only; real APIs and domain rules (verified in source); every string in Lingui; named shortcuts.
13. **Usable end to end.** The screen provides its archetype's full capability contract (`references/functionality.md`) wired to the record's real endpoints. A read-only mock or a disabled placeholder is not a design.

## Workflow

Follow these steps for any UI work. Steps 1–4 happen **before** writing code.

### Step 1 — Classify the work
Identify every surface the feature touches and read the matching references. Always read
`references/principles.md`, `references/functionality.md` and `references/anti-patterns.md`
once per task.

| The feature involves… | Read |
|---|---|
| A new page, module, record type, or navigation entry | `references/page-archetypes.md` |
| Any styling decision (color, type, spacing, radius, icons, dark mode) | `references/foundations.md` |
| Choosing or building components | `references/components.md` |
| A list, table, line items, tree, board | `references/tables-and-lists.md` |
| A form, input, settings, save behaviour | `references/forms.md` |
| Buttons, menus, modals, drawers, destructive actions, shortcuts | `references/actions-and-overlays.md` |
| Statuses, progress, toasts, alerts, loading, empty, error, locked states | `references/status-and-feedback.md` |
| Keyboard, drag & drop, motion, accessibility, responsive | `references/interaction-motion-a11y.md` |
| Anything operators use on the shop floor (`apps/mes`) | `references/shop-floor-mes.md` |
| Any user-facing words | `references/content-and-copy.md` |
| What users must be able to do; wiring edits, lines, statuses, locks | `references/functionality.md` |
| Unsure how far to reuse vs invent | `references/worked-examples.md` |

### Step 2 — Find the sibling and read it
Pick the archetype (`page-archetypes.md` §15) and open its exemplar files. Also find the
closest existing screen *in the same module*. Read their actual code — the exemplar is the
spec. Read its **routes** too (`$id.new`, `$id.$lineId.details`, `update.tsx`, `status`,
`confirm`, `delete`): that is where the functionality and the domain rules live, and your
screen will post to them. Canonical starting points:

| Need | Exemplar (paths from `apps/erp/app/`) |
|---|---|
| Module list | `routes/x+/sales+/rmas.tsx`, `modules/sales/ui/SalesReturnOrders/SalesReturnOrdersTable.tsx`, `modules/purchasing/ui/PurchaseOrder/PurchaseOrdersTable.tsx` |
| Document workspace | `routes/x+/sales-return-order+/$id.tsx` + `modules/sales/ui/SalesReturnOrders/SalesReturnOrder{Header,Explorer,Properties}.tsx`; richer: `modules/sales/ui/Quotes/QuoteHeader.tsx` |
| Config row CRUD | `routes/x+/sales+/customer-types.tsx` (+ `.new`, `.$customerTypeId`, `.delete.$customerTypeId`), `modules/sales/ui/CustomerTypes/CustomerTypeForm.tsx` |
| Record form | `modules/sales/ui/Customer/CustomerForm.tsx` |
| Line form | `modules/sales/ui/SalesOrder/SalesOrderLineForm.tsx` |
| Properties panel | `modules/quality/ui/Issue/IssueProperties.tsx` |
| Settings | `routes/x+/settings+/sales.tsx`, `routes/x+/settings+/items.tsx` |
| Status wrapper | `modules/sales/ui/Quotes/QuoteStatus.tsx` + `packages/utils/src/status-colors.ts` |
| Confirm / transition modal | `components/Modals/ConfirmDelete/ConfirmDelete.tsx`, `modules/inventory/ui/Receipts/ReceiptPostModal.tsx` |
| MES operator screen | `apps/mes/app/components/JobOperation/JobOperation.tsx`, `apps/mes/app/components/OperationsList.tsx` |

### Step 3 — Decide reuse / extend / create
For each piece of UI, decide and record which:
- **Reuse** — an existing component or pattern whose *job* matches.
- **Extend** — the job matches but a recurring need is missing (new variant/prop). Prefer this
  over a near-duplicate component.
- **Create** — the job is genuinely new. Build it from tokens and primitives following
  `components.md` §7 so it is native to the system.
- **Never force-fit** — if using an existing component would bend its meaning (Status for a
  category, Table for three config items, Alert for routine info), create instead.

### Step 4 — Write a short design brief (before code)
Keep it to ~15 lines. It is what you'll review against in Step 6.

```
Design brief — <feature>
- Users & context: <who, desk or floor, how often>
- Archetype(s): <A–I / MES> — exemplar: <path(s)>
- Layout & hierarchy: <what is identity, primary action, work, metadata; where each lives>
- Actions: <primary per surface; secondary; what goes in ⋯ / row menu; destructive flow>
- Create/edit: <where it opens; container; save model>
- Data display: <list shape; renderers per value type; statuses + colors by lifecycle position>
- States: <empty / loading / error / locked / no-permission — incl. every overlay that fetches>
- Data cases: <nulls and special values the domain already models (e.g. deadline types, locked
  rows, mixed selections, multi-currency) and how each renders — reuse the domain's own
  predicates (e.g. `deadlineRequiresDueDate`) instead of approximating>
- Capabilities: <one line per user job: job → surface → component → endpoint it posts to
  (`path.to.*`, verified) → what locks it. Every row of the archetype contract in
  `functionality.md` is either here or skipped with a reason>
- Copy: <titles, buttons, toasts, empty text — in Carbon patterns>
- Reuse / extend / create: <list, with the reason for each extend/create and what was rejected>
```
If the user asked only for a design (no code), the brief plus annotated ASCII wireframes and
component choices is the deliverable.

### Step 5 — Build
Follow the brief and the exemplar. **Wire every capability for real** — post to the record's
existing routes, reuse its validated form components where they fit, respect its lock
helpers. If a job has no endpoint, stop and say so rather than rendering a dead control.

**Build for real data.** Names are long, descriptions are missing, quantities have five
decimals, lists have 40 rows. In every flex row the text column is `flex-1 min-w-0` with
`truncate`/`line-clamp-1` on `w-full` children, fixed parts (thumbnails, badges, amounts,
trailing actions) are `shrink-0`, trailing hover actions are absolutely positioned over a
`pr-10` reserve, IDs are `whitespace-nowrap`, and tables inside cards use the `Table`
primitive (it scrolls horizontally itself) with no content forcing a card wider than its
column. Exemplar comment: `modules/sales/ui/SalesOrder/SalesOrderSummary.tsx:409-413`.
Content inside the 3-pane workspace lives in **resizable panes**, so its width has little to
do with the viewport: at a 1024 px screen with Explorer and Properties open, the content pane
is ~470 px. Size grids and row layouts inside panes with **container queries** (`@container`
on the card/row, then `@md:` / `@xl:` / `@3xl:` — Tailwind v4 built-in, precedent
`components/Gantt/Gantt.tsx`), not `md:`/`lg:` viewport breakpoints. Let status pills and
badges wrap (`flex-wrap`) rather than clip.

**Verify before you use — every time.** The most common way a Carbon-looking design breaks is
an invented API. Before writing any of these, open the source and confirm it:
- each import path and export (e.g. `NumberControlled` lives in `~/components/Form`, not
  `@carbon/react`; form fields need a `ValidatedForm`),
- each prop and its type (read the component's props type — e.g. `DatePicker` takes a
  `CalendarDate`, `Button` has no `success` variant),
- each `path.to.*` helper (grep `apps/erp/app/utils/path.ts`),
- each schema column or view you rely on (grep `packages/database/src/types.ts`; tables vs
  views differ),
- each helper or hook name (`formatDurationMilliseconds`, not a guess).
If you say "same as X" or "copied from X", import X's export or quote it exactly — never
re-type values from memory. If you can't verify something, say so in the brief as an open
question instead of stating it.

Make it mechanical: before finishing, write a **props audit** in your review summary — one
line per component you rendered, listing the props you passed and the `file:line` of the
props type you checked them against (e.g. `RadioGroupButton value,children — packages/react/src/Radio.tsx:54`).
Any prop you can't point to gets removed or replaced. Invented props (`size` on a component
that has none, `options` on a compound `Select`, `defaultSort` on `Table`, `isDisabled` on
`Checkbox` when it takes `disabled`) are the single most common defect in Carbon sketches.

Also obey the mechanics rules:
`.claude/rules/conventions-ui.md`, `.claude/rules/conventions-forms.md`,
`.claude/rules/i18n-lingui-system.md`, `.claude/rules/date-handling.md`,
`.claude/rules/numeric-precision.md`, `.claude/rules/table-csv-export.md`, `packages/react/AGENTS.md`.
Where those files disagree with the code (e.g. Card radius), the code wins — note it.

### Step 6 — Design-language review and browser verification (mandatory)
Run `references/design-review.md`: the seven questions, the checklist, the grep for red flags,
the state walk-through, **and §4 — render it in a real browser and use it**. Typecheck and
lint passing says nothing about layout or usability. Check whether the dev server is up
(`grep ^ERP_URL .env.local`, then load it); if it is, log in with the `auth` skill and
screenshot every screen at 1440, 1024 and 390 px wide, perform each capability from the brief
once (edit a quantity, change a date, add and delete a line, transition status), and look at
the screenshots before claiming anything. If no server can run, say explicitly that the UI is
unverified — never present it as done. **Fix every FIX and re-run** until clean. Work is not
done until the review summary is written. If something can't be made to fit without a system change (a new
shared component, a new token), stop and ask rather than improvising a one-off.

## When Carbon itself is inconsistent

Carbon has drift (listed in `references/anti-patterns.md` §3). Decide in this order:
1. the majority pattern in the code,
2. the newest canonical module (Sales Return Orders, Sept 2026),
3. the written rule.
Never copy a legacy pattern (`anti-patterns.md` §2) just because a sibling still has it, and
mention any drift you touched in your summary.

## Relationship to other guidance

- `.claude/rules/conventions-ui.md`, `.ai/ds-rules.md`, `packages/react/AGENTS.md` — component
  mechanics and hard rules; this skill builds on them and explains the *why*.
- `make-interfaces-feel-better` skill — generic polish; Carbon applies its motion, tabular-nums
  and text-wrap rules, but **not** image outlines or 40px ERP hit areas. This skill wins where
  they differ.
- `translate` skill — filling `.po` catalogs after you add strings.
- `test` / `agent-browser` skills — to look at the real rendered screen during review.

## Done when

- [ ] Design brief written (Step 4) and followed, including the capability table
- [ ] Every capability wired to a real endpoint and exercised once in the browser
- [ ] Screenshots at 1440 / 1024 / 390 px reviewed; no overflow, clipping or wrapping IDs
- [ ] Every reuse/extend/create decision recorded with its reason
- [ ] `references/design-review.md` checklist all PASS or justified N/A; red-flag grep clean or justified
- [ ] Review summary written in the final message, including open questions about drift
