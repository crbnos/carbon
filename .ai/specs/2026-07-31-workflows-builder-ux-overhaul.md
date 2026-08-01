# Workflows Builder UX Overhaul

**Status:** Draft — awaiting approval
**Date:** 2026-07-31
**Slug:** `workflows-builder-ux-overhaul`
**Rough notes this came from:** `.ai/plans/automation/pending-changes.md`

---

## Summary

The Workflows feature shipped its builder canvas across three recent commits. A
first real pass over the UI surfaced seven changes: one backend cleanup (an
over-engineered webhook signing secret) and six builder-UI changes that together
move node configuration out of a right-side drawer and onto the nodes themselves,
flip the graph from vertical to horizontal, and replace the placeholder node
palette and node cards with a properly designed, theme-consistent treatment.

## Problem

1. **The webhook secret is over-engineered.** Creating a workflow generates a
   per-workflow HMAC signing secret, shows it once in a "copy this now" screen,
   and signs every outbound webhook call with it. Nobody asked for this. A
   customer who wants the receiver to authenticate the call can add an
   `Authorization` header to the webhook action. The secret adds a database
   column, a one-time-reveal UI, signing code, and a documented security caveat
   (Postgres has no column-level RLS, so anyone who can read the workflow can
   read the secret) — all for a capability a header already provides.

2. **The builder UI is a first draft.** Node configuration lives in a right
   drawer, so the canvas and the thing you are editing are never in the same
   place. The graph flows top-to-bottom, which reads worse than left-to-right for
   a rule that is fundamentally "when this, then that". Connection handles are
   ReactFlow's 6px defaults and are hard to grab. The node palette is a fixed-width
   strip of text labels with a colour swatch that does not resize with its panel and
   shows a stray border. Nodes carry six arbitrary per-kind hex colours that ignore
   the company's theme. Nodes silently collapse and expand as you zoom, which is
   disorienting.

## Goals

- Remove the webhook signing secret from the schema, the service, the UI, and the
  webhook action, with no replacement mechanism.
- Show the workflow's name in the breadcrumb on its detail page.
- Delete the right-hand configuration drawer; every node's configuration renders
  inside the node.
- Flow the graph left → right: inputs on a node's left edge, outputs on its right.
- Make handles large enough to grab comfortably, with a clear hover state.
- Redesign the node palette as a proper list: icon, name, description, correct
  resize behaviour.
- Drop per-kind colours in favour of the company's theme colour, with each node
  kind identified by its icon.
- Replace zoom-driven collapse with an explicit per-node minimize control, saved
  with the workflow.

## Non-goals

- No change to the workflow runtime, the engine, the matcher, the event catalog,
  or the run-history/retention work in flight. This is presentation plus one
  schema removal.
- No change to what the six node kinds *do*, to the validator, or to
  `getNodeHandles` — handle **identity** is unchanged; only its position and
  styling move.
- No new node kinds, no auto-layout, no canvas minimap/controls redesign.
- No change to the other two things in this repo called "webhook" — the
  event-system `WEBHOOK` subscription handler and the inbound integration webhook
  routes are untouched.
- No `Duplicate node` action (considered for the node menu, cut — nothing like it
  exists today and it was not asked for).

## Research

**N/A — deliberately skipped.** No domain logic is being invented. The backend
change is a removal, and the UI changes were specified directly by the user. The
patterns adopted (configuration inline on the node, left→right graph flow, an
icon + description palette list) are the established conventions of every mature
node-graph editor — n8n, Zapier, Make, Retool Workflows — and need no
investigation to apply.

---

## Design

### 1. Remove the webhook signing secret

The column was added by
`packages/database/supabase/migrations/20260731025358_workflows-webhook-secret.sql`,
which is committed on `feat/automation` only — it has **never reached `main`**, so
no production database has ever had it. It is therefore removed as if it never
existed rather than dropped by a follow-up migration.

> **Do not touch the unrelated `*_WEBHOOK_SECRET` values.**
> `STRIPE_WEBHOOK_SECRET`, `XERO_WEBHOOK_SECRET` and `QUICKBOOKS_WEBHOOK_SECRET`
> in `packages/env/src/index.ts`, and their uses in `packages/stripe/**` and
> `apps/erp/app/routes/api+/webhook.xero.ts`, are inbound integration signing
> keys for third-party services. They share a name fragment with this column and
> nothing else. A case-insensitive grep for "webhook secret" matches them — they
> are out of scope and must survive this change untouched.

**Database.** Delete the migration file. Regenerate types with
`pnpm run generate:types`, which drops `webhookSecret` from
`packages/database/src/types.ts`, `packages/database/src/swagger-docs-schema.ts`
and `packages/database/supabase/functions/lib/types.ts`.

> ⚠️ The local development database already has this column applied. Deleting the
> migration file does not remove it from a database that already ran it. The local
> database needs a reset for this change to take effect. Per `AGENTS.md` this is
> **never** done automatically — the user runs it, or explicitly asks for it to be
> run, when they are ready.

**Service.** `insertWorkflow` in
`apps/erp/app/modules/workflows/workflows.service.ts` currently ends
`.select("id, webhookSecret").single()`. It becomes `.select("id").single()`. The
comment above it explaining why insert and update are separate functions ("only
the insert may ever select `webhookSecret` back") no longer applies; insert and
update stay separate on their own merits, and the comment is removed.

**Create route.** `apps/erp/app/routes/x+/workflows+/new.tsx` currently ends by
returning `data({ id: created.data.id, webhookSecret: created.data.webhookSecret })`
under a comment explaining the create modal's success state. It returns
`{ id: created.data.id }`, and the comment goes with it.

**Form.** `apps/erp/app/modules/workflows/ui/WorkflowForm.tsx` drops the entire
`created` branch — the `CreatedWorkflow` type, the `dismissedSecret` state, the
"Workflow created" reveal screen, the copy button, and the `copyToClipboard` /
`LuCopy` / `toast` imports that only served it. On successful creation the form
navigates straight to the new workflow.

**Action.** `packages/jobs/src/workflows/actions/webhook.ts` drops the
`createHmac` import, the secret read, the `Carbon-Timestamp` and
`Carbon-Signature` headers, and the `"This workflow has no signing secret."`
refusal. Everything else about the action is deliberately kept: the SSRF guard in
`actions/url-guard.ts`, the https-only rule, `redirect: "manual"`, the 10s
timeout, and the response-body summary. Those are real protections and are
unrelated to signing.

**Tests.** `packages/jobs/src/workflows/actions/webhook.test.ts` is built around
the secret: it imports `createHmac`, its `fakeClient(webhookSecret)` helper stubs
the workflow row's secret read, one test recomputes the expected signature and
asserts the two headers, and another asserts the
`"This workflow has no signing secret."` refusal. The signature test, the
no-secret test and the `createHmac` import are deleted, and `fakeClient` loses its
parameter. The SSRF, https-only, redirect-refusal, timeout and response-excerpt
tests stay and must still pass — they are the reason the file exists.

**Docs.** Three files describe the signing and are corrected in the same change,
per `keep-sources-in-sync.md`:

- `.claude/rules/workflow-actions.md` — the "The webhook action" section (scheme,
  column, RLS caveat) and the three-webhook comparison table row that calls the
  workflow action "outbound, per-workflow HMAC".
- `packages/jobs/AGENTS.md` line 113 — the `webhook.ts` row describing the
  `Carbon-Signature` HMAC.
- `apps/erp/app/modules/workflows/AGENTS.md` lines 9 and 65 — the Workflow entity
  description listing `webhookSecret` as a column, and the note explaining that
  `insertWorkflow` / `updateWorkflow` are separate "because only the insert may
  select `webhookSecret` back". That note is now false; the two functions stay
  separate, but the stated reason is removed.

Removing an output is a definition-level question: the action's declared outputs
in `packages/workflows/src/catalog/actions.ts` are `{ status: t.number }` and are
**unchanged** — the secret was never an output. No catalog regeneration is needed.

### 2. Breadcrumb on the workflow detail page

`apps/erp/app/routes/x+/workflow+/$id.tsx` has no `handle.breadcrumb`, so the
crumb stops at the layout's `Workflows`. The repo already has the helper for
exactly this case, used by `apps/erp/app/routes/x+/job+/$jobId.tsx`:

```ts
export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Workflows`, to: path.to.workflows },
    (data) => data?.workflow?.name
  ),
  module: "workflows"
};
```

`detailBreadcrumb` (`apps/erp/app/utils/handle.ts`) returns the list crumb alone
when the loader has no data yet and both crumbs once it does, so there is no flash
of a half-built trail. The loader already returns `workflow` with `name` on it.

### 3–7. The builder

These five changes are one coherent redesign and are described together.

#### Layout: two panels, not three

`WorkflowBuilder.tsx` currently renders a three-panel `ResizablePanelGroup`:
palette | canvas | config. The config panel is deleted and the canvas takes its
space.

```
before                                   after
┌────────┬──────────────┬─────────────┐  ┌──────────┬────────────────────────┐
│ palette│    canvas    │ config panel│  │ palette  │        canvas          │
│ (14%)  │    (62%)     │    (24%)    │  │  (18%)   │        (82%)           │
└────────┴──────────────┴─────────────┘  └──────────┴────────────────────────┘
```

`panel/ConfigPanel.tsx` is deleted. The six form components it dispatched to are
the valuable part and are **kept as-is** — they already take a node and write
through `updateNodeData`, which works identically inside a node card. The
directory is renamed `panel/` → `config/` since it no longer describes a panel;
`NodeNameField.tsx`, `ClauseRow.tsx`, `forms/` and the `NODE_FORMS` map move with
it unchanged. `fields/` is untouched.

The `IssuesPanel` slide-over and `DeleteNodeDialog` are unaffected. Delete moves
its trigger from the config panel's icon button to the node menu (below), but
reuses the same dialog.

#### The node card

`NodeCard.tsx` is rewritten. It gains two states, chosen by the user and never by
zoom:

```
expanded (default, ~440px, height grows to fit)     minimized (260px)
┌──────────────────────────────────────────┐       ┌────────────────────────┐
│ ⬤  ACTION                            ⋮  │       │ ⬤  ACTION          ⋮ │
│    Notify the buyer                      │  ◀━▶  │    Notify the buyer    │
├──────────────────────────────────────────┤       │    Notify a person     │
│  Action    [ Notify a person        ▾ ]  │       └────────────────────────┘
│  To        [ ⌗ Buyer                 ]   │
│  Subject   [ PO {{record.id}} late   ]   │        one-line summary from
│  Message   [ ...                     ]   │        NODE_KIND_META.summary
└──────────────────────────────────────────┘
```

- **Width:** `w-[440px]` expanded, `w-[260px]` minimized. Height is intrinsic in
  both — no inner scroll area, because a scrollable region inside a node fights
  the canvas's scroll-to-zoom.
- **Colour:** the `accent` prop and the six hex values in `NODE_KIND_META` are
  removed. The icon chip uses the theme primary
  (`bg-primary text-primary-foreground`), and selection uses `ring-primary`.
  Per `coding-conventions.md`, theme colours are CSS variables — nothing
  hard-codes a colour.
- **Icon:** `NODE_KIND_META` already carries a per-kind `Icon`
  (`LuZap`, `LuSplit`, `LuPlay`, `LuPencilRuler`, `LuSearch`, `LuFilter`). Kind is
  now conveyed by that icon plus the kind label, not by hue.
- **Body:** when expanded, the card renders `NODE_FORMS[node.type]` for its own
  node. When minimized, it renders the existing `NODE_KIND_META[kind].summary(node)`
  one-liner.
- The issue badge, the node title and `NodeNameField` behave as they do today.

#### The node menu (⋮)

A `DropdownMenu` from `@carbon/react` in every node's top-right corner:

| Item | Shown when | Behaviour |
|---|---|---|
| Minimize / Expand | always | toggles this node's `expanded` flag |
| Batch mode | node is an `action`, and its catalog action has `batchable: true` | toggles the existing `data.batch` boolean |
| Delete | every kind **except `trigger`** | opens the existing `DeleteNodeDialog` |

Delete is hidden on the trigger node because the store already refuses to remove
it — `removeNode` in `ui/Builder/store.ts` returns early on
`node.type === "trigger"`, and the deleted `ConfigPanel` gated its trash button on
the same `canDelete = node.type !== "trigger"`. A menu item that silently did
nothing would be worse than no menu item.

Batch mode is **not a new capability** — `data.batch` already exists on action
nodes in `packages/workflows/src/definition/schema.ts`, the engine already reads
it (`batchTargetFor` / `planBatch` in `packages/jobs/src/workflows/engine/execute.ts`),
and `ActionForm.tsx` already renders a switch for it at line ~491. That switch is
removed from the form and the flag is driven from the menu instead, so the
persistent control lives in one place.

`ActionForm` also carries a second, different batch affordance just above the
switch: an amber callout that appears only when a list is wired into a
non-batching action, offering "Run once per item". That **stays**. It is a
one-way contextual hint that depends on the node's wired inputs — knowledge only
the form has — not a duplicate of the toggle.

The whole menu is suppressed when the builder is read-only (viewing the published
version), matching how the palette and handles already behave.

#### Minimize state: a per-node flag in the definition

`nodeBase` in `packages/workflows/src/definition/schema.ts` gains one field, next
to `position` — node layout already lives in the definition, so this is the same
kind of data in the same place:

```ts
const nodeBase = {
  id: z.string().min(1),
  title: z.string().optional(),
  position: z.object({ x: z.number(), y: z.number() }),
  /** Presentation only. Default true, so every stored definition still parses. */
  expanded: z.boolean().default(true)
};
```

`CURRENT_DEFINITION_FORMAT_VERSION` stays at `2`. The field is optional with a
default, so every already-stored definition parses unchanged and reads as
expanded — which is exactly the desired default. A bump would force a migration
of stored definitions for no benefit.

`toReactFlow` / `fromReactFlow` / `createNode` in
`ui/Builder/graph.ts` carry the flag through, and `createNode` sets `expanded: true`.
Toggling it goes through the existing store mutation path, so it marks the workflow
dirty and autosaves like a node move already does.

#### Zoom no longer changes anything

`LOD_ZOOM` is deleted from `ui/Builder/constants.ts` and the level-of-detail
calculation is removed from `nodes/WorkflowNodeCard.tsx`. A node's appearance is a
function of its own `expanded` flag and nothing else. `NODE_KIND_META[kind].summary`
survives — it now feeds the minimized card instead of the zoomed-out one.

#### Handles: left → right

In `NodeCard.tsx`:

- Target: `<Handle type="target" position={Position.Left} id="in" />`
- Sources: one `<Handle type="source" position={Position.Right} id={port.id} />`
  per port

`getNodeHandles` from `@carbon/workflows` is the single source of handle identity
for both the canvas and the validator, and is **not touched** — `out`,
`success`/`failure`, and condition path ids keep their meanings. Only `Position`
changes.

Multi-output nodes (a condition's `if` / `elseIf` / `else`, an action's
`success` / `failure`) currently lay their ports out as a horizontal row of pills
at the card's bottom. Stacked on the right edge they become labelled rows inside
the card's lower section, each with its handle pinned to that row's vertical
centre on the card's right edge — so a label always sits beside the handle it
names, and edges leave from the row the customer read:

```
┌──────────────────────────────────────────┐
│ ⬤  CONDITION                         ⋮  │
│    Only if                               │
├──────────────────────────────────────────┤
│  If   status  is  Open                   │
├──────────────────────────────────────────┤
│                              If  ────────⬤
│                          Else if ────────⬤
│                            Else  ────────⬤
└──────────────────────────────────────────┘
```

`edges/WorkflowEdge.tsx` uses `getSmoothStepPath`, which derives its corner
geometry from the source and target `Position` values it is handed — it produces
correct horizontal routing with no change. The file is left alone.

#### New nodes are placed to the right, not below

`nextNodePosition` in `ui/Builder/graph.ts` currently places a new node **below**
its anchor (`y + NODE_HEIGHT + GAP_Y`) and nudges it **right** on collision. That
is the vertical layout's rule and it contradicts a left→right graph: clicking a
palette entry would drop the new node underneath the one it is wired from, so
every auto-placed edge would immediately double back on itself.

The rule inverts — place to the right (`x + NODE_WIDTH + GAP_X`), nudge down
(`y += NODE_HEIGHT + GAP_Y`) on collision. `NODE_WIDTH` rises from `260` to `440`
to match the expanded card, so collision detection reflects the real footprint.
`TRIGGER_POSITION` stays `{ x: 0, y: 0 }`.

#### Handle styling

Handles get a shared class in `NodeCard.tsx`, replacing ReactFlow's 6px default:

- 12px circle (`size-3`), 2px card-coloured border, theme-primary fill — big
  enough to hit without precision aiming.
- Hover and during-connection: scale to ~1.35 and a soft primary ring
  (`shadow-[0_0_0_4px_hsl(var(--primary)/0.18)]`), so the drop target is obvious
  mid-drag.
- Connected handles read solid; unconnected read hollow (card fill, primary
  border), which makes an unwired `failure` port visible at a glance — the
  existing "unwired failure handle" signal in `WorkflowNodeCard.tsx` is preserved
  and now has a visual home.

#### Forms inside a canvas node

Putting real inputs inside a ReactFlow node needs two guards, both standard
ReactFlow practice:

- The form region carries `nodrag` so dragging inside a text field or slider edits
  the field instead of moving the node.
- Any internally-scrollable descendant (a combobox listbox) carries `nowheel` so
  the wheel scrolls the list instead of zooming the canvas.

The existing `onKeyDownCapture` guard in `WorkflowBuilder.tsx` — which stops the
canvas stealing `Delete` and arrow keys from a focused field, and stops overlays
(popovers, menus, dialogs) leaking their keys to the canvas — becomes
load-bearing rather than incidental, and is kept exactly as written.
`onlyRenderVisibleElements` stays on: expanded nodes are far heavier than the old
cards, and off-screen ones should not render.

#### The node palette

`NodePalette.tsx` is rewritten. The resize bug is that the `<aside>` is
`w-[118px] shrink-0` with its own `border-r` **inside** a `ResizablePanel` — so the
panel resizes while its contents do not, and the aside's border floats away from
the panel edge. The aside becomes `h-full w-full` with no fixed width and no
border of its own; the border belongs to the panel boundary.

Each entry becomes a proper list row — icon, name, description — reading the
description already present in `NODE_KIND_META`:

```
┌────────────────────────────────┐
│  ADD A STEP                    │
│                                │
│  ⚡  Trigger                   │
│      Starts the workflow       │
│                                │
│  ⋔  Condition                  │
│      Sends the run down one    │
│      path                      │
│                                │
│  ▶  Action                     │
│      Notifies, sends or calls  │
│      out                       │
└────────────────────────────────┘
```

The colour swatch is gone; the icon identifies the kind, tinted with the theme
primary. Drag-and-drop (`NODE_DRAG_TYPE`), click-to-add, and the "a workflow can
only have one trigger" disabled-with-tooltip behaviour are all preserved exactly.

Because rows now carry two lines of text, the panel's size bounds are widened from
`defaultSize={14} minSize={10} maxSize={22}` to
`defaultSize={18} minSize={14} maxSize={26}`. The `autoSaveId="workflow-builder"`
on the panel group persists the user's chosen width across sessions and is kept —
note that a stored three-panel layout under that id must not resurrect the deleted
config panel, so the id is changed to `workflow-builder-v2` to invalidate stale
saved layouts cleanly.

---

## Design Decisions

| # | Decision | Choice | Why |
|---|---|---|---|
| 1 | How to remove the webhook secret column | Delete the original migration file; no drop migration | It is committed on `feat/automation` only and has never reached `main`, so no production database has it. A drop migration would record history for a column that never shipped. |
| 2 | Replacement for webhook signing | None | A customer who needs the receiver to authenticate can set an `Authorization` header on the webhook action. The SSRF guard, https-only rule and redirect refusal are kept — they are unrelated to signing. |
| 3 | Local dev database with the column already applied | User resets it themselves, when ready | `AGENTS.md`: never rebuild the database to test changes — wait for the user. |
| 4 | Breadcrumb mechanism | `detailBreadcrumb` in `handle` | Already the repo's helper for list → detail crumbs; used by the job detail route. Handles the pre-load state. |
| 5 | Where node configuration lives | Inside the node card | The user's explicit call. Editing and seeing the graph in one place; matches every mature node editor. |
| 6 | Fate of the six form components | Kept unchanged, directory renamed `panel/` → `config/` | They take a node and write via `updateNodeData` — nothing about them assumed a drawer. Rewriting them would be churn. |
| 7 | Expanded node width | 440px, intrinsic height | Every field visible with no inner scrollbar; an internal scroll region fights canvas scroll-to-zoom. |
| 8 | What controls collapse | An explicit per-node `expanded` flag; never zoom | Zoom-driven collapse is disorienting — the canvas changes shape as you navigate it. |
| 9 | Where the flag is stored | `nodeBase.expanded` in the workflow definition | Node layout (`position`) already lives there; this is the same kind of data. Survives reload and is shared with teammates. |
| 10 | Definition format version | Stays at 2 | The field is optional with `default(true)`, so stored definitions parse unchanged and read as expanded. A bump would force a migration for no benefit. |
| 11 | Node menu contents | Minimize/Expand, Batch mode, Delete | The user's selection. Delete needs a new home now that the drawer is gone. |
| 12 | Batch mode | Relocated, not built | `data.batch`, `planBatch` and the engine's batch handling already exist; `ActionForm`'s switch moves to the menu so the flag has one home. |
| 13 | Duplicate node | Cut | Not asked for, nothing like it exists today. YAGNI. |
| 14 | Node colour | Theme primary only | The company's theme should govern. Six hard-coded hexes ignore it, and `coding-conventions.md` requires CSS variables. |
| 15 | Kind identification without colour | The per-kind icon, already in `NODE_KIND_META` | The data is already there; the palette just never used it. |
| 16 | Handle identity when flipping direction | Unchanged | `getNodeHandles` is shared by the canvas and the validator. Only `Position` moves. |
| 17 | Multi-output label placement | Labelled rows inside the card, handle pinned to each row's right edge | A vertical stack of floating outside labels overlaps outgoing edges. |
| 18 | Edge routing | `WorkflowEdge.tsx` untouched | `getSmoothStepPath` derives geometry from the `Position` values passed to it. |
| 19 | Canvas/form event conflicts | `nodrag` on form regions, `nowheel` on scrollable descendants | Standard ReactFlow practice; the existing `onKeyDownCapture` guard already covers keys. |
| 20 | Palette resize bug | Aside becomes `h-full w-full`, border moves to the panel boundary | The fixed `w-[118px] shrink-0` inside a `ResizablePanel` is the bug itself. |
| 21 | Saved panel layout | `autoSaveId` → `workflow-builder-v2` | A stored three-panel layout must not resurrect the deleted config panel. |

---

## Acceptance Criteria

**Webhook secret**

1. Creating a workflow navigates straight to the builder; no secret is displayed
   at any point.
2. `grep -rn "webhookSecret" apps packages` returns no matches. (Note the
   case-sensitive term: `STRIPE_WEBHOOK_SECRET`, `XERO_WEBHOOK_SECRET` and
   `QUICKBOOKS_WEBHOOK_SECRET` are unrelated third-party integration keys and
   must still be present.)
3. A webhook action fires against a test endpoint and the request carries no
   `Carbon-Signature` or `Carbon-Timestamp` header; a user-supplied
   `Authorization` header would be the only auth present.
4. A webhook action pointed at `http://…`, at `127.0.0.1`, or at an address that
   returns a 3xx is still refused with its existing message.
5. `.claude/rules/workflow-actions.md`, `packages/jobs/AGENTS.md` and
   `apps/erp/app/modules/workflows/AGENTS.md` no longer describe signing, a
   secret column, or an RLS caveat for it.
6. `webhook.test.ts` still covers the SSRF guard, the https-only rule, the
   redirect refusal, the timeout and the response excerpt, and passes.
7. Stripe and Xero inbound webhook verification is unchanged and their tests
   still pass.

**Breadcrumb**

8. Opening a workflow named "Late PO alert" shows `Workflows / Late PO alert`;
   the `Workflows` segment links back to the list.

**Builder**

9. The builder renders two panels. No configuration drawer exists in the DOM at
   any width or selection state.
10. Clicking an action node shows its full configuration (action picker, inputs,
    template fields, variable picker) inside the node card, and edits persist
    through autosave and a page reload.
11. Zooming from 0.25 to 2.0 never changes any node between its expanded and
    minimized form.
12. Choosing Minimize on a node collapses it to the 260px summary card; reloading
    the page shows it still minimized. Choosing Expand restores it.
13. The ⋮ menu on an `action` node whose action is batchable offers Batch mode,
    and toggling it produces the same saved definition as the old `ActionForm`
    switch. A `condition` node's menu offers no Batch mode item.
14. Delete from the ⋮ menu opens the existing confirm dialog and removes the node
    and its edges.
15. Every node's input handle is on its left edge and its output handles are on
    its right edge; edges route horizontally with no overlap of the cards they
    connect.
16. A condition node with three paths shows three labelled output rows, each with
    its handle beside its own label, and dragging from the `else` handle creates
    an edge whose `sourceHandle` is the `else` path id.
17. Handles are visibly larger than before, show a ring on hover, and can be
    grabbed and dragged without repeated missed attempts.
18. Typing in a node's text field does not drag the node; scrolling a combobox
    list inside a node does not zoom the canvas; pressing Delete in a focused
    field does not delete the node.
19. No node or palette row renders a hard-coded hex colour; switching the company
    theme changes the node and palette accent.
20. Each palette row shows an icon, a name and a description. Dragging the panel
    divider resizes the rows with it, and no stray internal border appears.
21. Adding a trigger disables the palette's Trigger row with its existing
    tooltip.
22. Viewing the published (read-only) version shows no palette, no ⋮ menus, and
    no draggable handles.

**Regression**

23. `pnpm exec turbo run typecheck --filter=erp --filter=@carbon/workflows --filter=@carbon/jobs` passes.
24. `pnpm exec biome check` reports no new error-severity findings.
25. `pnpm run test` passes, including `graph.test.ts` and the workflows package
    suites.
26. A workflow saved before this change loads with every node expanded and no
    validation issues introduced.

---

## Open Questions

All resolved with the user before this spec was written.

- [x] **Does this spec cover all seven noted changes, or only the UI ones?** —
  **Answer:** All seven, including the webhook-secret removal, so the backend
  cleanup and the UI overhaul land together.
- [x] **With the drawer gone, where does a node's configuration appear?** —
  **Answer:** Inside the node itself. Additionally: nodes are always expanded by
  default and must never expand or collapse in response to zoom; a three-dot menu
  in each node's top-right corner carries a minimize option and, where available,
  a batch-mode option; a minimized node shows only its compact form.
- [x] **Should a node stay expanded after you click away?** — **Answer:**
  Superseded by the previous answer — expansion is user-controlled, not
  selection-controlled, and whatever state a node is in persists.
- [x] **Where is that state saved?** — **Answer:** Per node, as a boolean on the
  node itself in the workflow definition, alongside `position`.
- [x] **What belongs in the three-dot menu?** — **Answer:** Minimize/Expand,
  Batch mode, and Delete. Duplicate was offered and declined.
- [x] **How wide is an expanded node?** — **Answer:** ~440px, growing as tall as
  it needs, with no inner scroll area.
- [x] **How is the webhook secret column removed?** — **Answer:** Edit the
  original migration in place (delete it), since it never reached `main`. The
  local dev database needs a reset, which the user will run themselves.

---

## Changelog

- **2026-07-31** — Initial draft. Seven changes specified: webhook-secret removal
  (schema, service, form, action, docs), workflow-name breadcrumb, config drawer
  removed in favour of in-node configuration, graph flipped to left→right, handle
  restyling, node palette redesign, and node card redesign on the company theme
  with an explicit per-node minimize replacing zoom-driven collapse. All seven
  open questions resolved with the user before writing.
- **2026-07-31** — Self-review corrections after grepping the real spread of
  `webhookSecret`. Added three removal sites the first draft missed: the create
  route `x+/workflows+/new.tsx` (which returns the secret to the modal),
  `webhook.test.ts` (built around signing), and the two `AGENTS.md` files that
  document it. Recorded that `packages/database/supabase/functions/lib/types.ts`
  also regenerates. Added an explicit carve-out for the unrelated
  `STRIPE_`/`XERO_`/`QUICKBOOKS_WEBHOOK_SECRET` integration keys, which a
  case-insensitive grep matches, and corrected the acceptance criterion that
  would have falsely failed on them.
- **2026-07-31** — Three corrections found while planning, from reading the code
  each task touches. (a) Delete is hidden on the trigger node, not shown always —
  `store.removeNode` already refuses to delete a trigger and the old panel gated
  its trash button the same way. (b) `nextNodePosition` must invert with the
  layout: new nodes go right and nudge down, and its `NODE_WIDTH` constant rises
  260 → 440; left unchanged, auto-placed nodes would land below their anchor and
  every new edge would double back. (c) `ActionForm`'s amber "Run once per item"
  callout is kept — only the persistent Switch moves to the node menu; the
  callout is a one-way hint driven by the node's wired inputs, not a duplicate
  control.
