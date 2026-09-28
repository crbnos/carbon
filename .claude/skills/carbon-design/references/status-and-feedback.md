# Status, feedback and system states

## Contents
1. Status — color semantics
2. Status components and placement
3. Progress
4. Toasts and flash
5. Alerts (in-page)
6. Loading
7. Empty states
8. Errors, not-found, access denied
9. Disabled, read-only, locked, plan-gated
10. Interactive state classes

---

## 1. Status — color semantics

Single source of truth: `packages/utils/src/status-colors.ts` (`*_STATUS_COLOR_MAP` per
entity + registry). Rendered by `<Status color>` (`packages/react/src/Status.tsx`): uppercase
12px tinted pill + a **fixed icon per color** + tooltip. Color is never the only signal.

**Choose the color by lifecycle position, not by the word:**

| Position | Color | Icon | Typical values |
|---|---|---|---|
| Not started / draft / queued | `gray` | dashed circle | Draft (100% consistent), Todo, Open, Registered, Queued |
| Scheduled / waiting on someone / needs approval | `yellow` | clock | Planned, Needs Approval, To Review, Waiting, Invited |
| Released / in motion / with another party | `blue` | loader | Ready ("Released"), Sent, Confirmed, To Invoice, Submitted, generic In Progress |
| Being worked / partial / needs attention | `orange` | alert circle | Job & operation In Progress/Paused, To Ship, To Receive, Pending, Partial, Due Today |
| Terminal success | `green` | check | Completed, Done, Posted, Paid, Active, Passed, Closed (issue/period) |
| Terminal failure / cancelled / dead | `red` | slash | Cancelled, Voided, Rejected, Expired, Failed, Overdue, Archived, Closed (orders/RFQs) |
| Special | `purple` | star | Skipped (only) |

Known splits (follow the majority unless you're extending that exact entity family):
`In Progress` blue for generic docs, **orange for production** (deliberate); `Closed` red for
orders; `Pending` orange; `Overdue` red; `Archived` red; `Inactive` gray.

A new status: add a map to `status-colors.ts` and a `{Entity}Status.tsx` wrapper. Never an
inline color map in a component.

## 2. Status components and placement

Wrapper (one per entity, `modules/{module}/ui/{Entity}/{Entity}Status.tsx`), exemplar
`modules/sales/ui/Quotes/QuoteStatus.tsx` — returns `null` for missing/unknown values, owns
display aliasing ("Ready" shown as "Released", raw value in tooltip) and derived statuses
(`ShipmentStatus` → "Invoiced"). **Translate the label** (older wrappers render the raw enum —
don't copy that).

Where status appears:
1. **Record header**, right after the ⋯ menu, followed by derived badges ("Overdue", "3d late"
   with a projected-date tooltip, "Due Today").
2. **List Status column** — the wrapper is the cell *and* the filter option label; `LuStar`
   icon; `pluralHeader: t\`Statuses\``.
3. **Cross-entity summaries** — related documents show each other's status (receipts inside a
   PO header dropdown, job status on SO lines).
4. **Properties panel** only when status is edited there. Normally status changes via header
   transitions.
5. **Icon-only status** in dense rows: `OperationStatusIcon` + tooltip.
6. **Stage flow** for multi-document journeys (RFQ → Quote → Order; change notice stages): a
   `Menubar` strip — current stage `font-semibold` with emerald icon, done stages
   `text-foreground/70` + `LuCheck`, future `text-muted-foreground` + `LuCircle`
   (`modules/items/ui/ChangeNotice/ChangeNoticeStatusFlow.tsx`).

Status vs other chips: `Status` = lifecycle; `Enumerable` = user-defined values (color
meaningless); `Badge` color = ad-hoc facts. `PulsingDot` = "live / active now", not status.

## 3. Progress

`BarProgress` is the house meter (segmented 2px bars; default emerald fill; `gradient`
red → green; `invertGradient` when lower is better; `label`/`value` header; accessible
`role="progressbar"`). Table cell: `value={\`${done}/${total}\`}`. Numbers always get their
denominator ("12 of 40", `4e795c4f0c`). Don't use `Progress`. Time-relative progress uses
badges: "3d late" (red) / "2d early" (green) with a tooltip.

## 4. Toasts and flash

- **Results of actions are toasts.** Server actions: `flash(request, success("…"))` /
  `error(err, "…")` then `redirect` (`.claude/rules/flash-system.md`); client: `toast.success`
  / `toast.error`. Don't restyle — success toasts are **solid blue**, errors solid red
  (`packages/react/src/Toast.tsx`); ERP bottom-right, MES bottom-left.
- Validation errors are inline, never toasts.
- Properties autosave toasts on error only.

Wording (sentence case, no trailing period, no exclamation):

| Outcome | Pattern | Example |
|---|---|---|
| Update | verb-first past tense | "Updated quote line" |
| Create | noun-first | "Customer type created" |
| Delete | "<Noun> deleted" (preferred) or "Successfully deleted <noun>" (legacy majority) | "Supplier part deleted" |
| Domain action | noun + past participle | "Journal entry posted" |
| Failure | **"Failed to <verb> <noun>"** (82%) + `: ${message}` in client toasts | "Failed to update quote" |
| Recoverable | "… Please try again." | |
| Load failure | redirect to the list with "Failed to load <noun>" | |

Wrap client toast strings in `t`. (Server flash strings are English today — a known gap; if you
add new ones, keep them short and in this grammar.)

## 5. Alerts (in-page)

`Alert` variants `destructive | warning | info | success | default`, anatomy
`<Alert variant><LuIcon/><AlertTitle/><AlertDescription/></Alert>`, short title phrase.
Use for a **condition** the user must see while doing something (inside a modal or form):
"Lines need prices or lead times". Not for action results (toasts) and not for routine
context — a loud warning for information becomes a calm `Card` with one accent icon or
`Alert variant="info"` (`b15cb4e9f2`). A decision is a Modal with explicit choices, not a
banner.

## 6. Loading

| Situation | Pattern |
|---|---|
| Route navigation | global NProgress bar — nothing to add |
| Table reload | built-in skeleton after 300ms |
| Action button | `Button isLoading={fetcher.state !== "idle"}` / `Submit` does it |
| Confirm modal acting via navigation | `isDisabled={navigation.state !== "idle"}` |
| Deferred loader data | `<Suspense fallback={<XSkeleton/>}><Await>` with a skeleton of the real shape (`components/Skeletons.tsx`), or `null` if the area can pop in |
| Region with unknown shape | `<Loading isLoading>` |
| Inline small wait | `<Spinner size={16} />` |
| Full-screen brand wait | `CarbonPulse` |
| Status change / assignment | **optimistic**: render pending `fetcher.formData` as truth (`components/Assignee.tsx` `useOptimisticAssignment`) |
| Loading copy | "Loading..." or "Loading <noun>..." |

Never flash an empty state before data arrives — show a skeleton (`7f5f1d2145`).

**Surfaces that fetch when opened** (a drill-down drawer, a preview modal, a popover, an MES
sheet loading reasons) have three explicit states, keyed on the fetcher/loader:
1. `fetcher.state !== "idle"` or no data yet → `Skeleton` rows of the real shape (or
   `Loading`). Never show the previous selection's rows, and never show the empty message.
2. Error → `toast.error(t\`Failed to load …\`)` or an inline `Alert variant="destructive"`
   in the overlay, with the overlay still usable (close/retry).
3. Loaded and empty → the empty pattern below. Only now.
Reset or key the fetcher per selection (e.g. `fetcher.load(url)` on open, render from
`fetcher.data` only when it matches the selected key).

## 7. Empty states

| Context | Pattern |
|---|---|
| Table | built in: "No data exists" + Add; "No results found" + Remove Filters; `emptyState` override for pre-filtered tables |
| Panel / explorer / card list | `<Empty>` (`components/Empty.tsx`): `LuCircleDashed` muted, `text-xs` "Looks empty here 👀", optional children = **one** secondary `Button leftIcon={<LuCirclePlus/>}` "Add …", shown only with permission and not locked |
| Selector / combobox | `useEmptyState` → "No <plural> yet" + inline link "Add your first <noun> so you can assign it here." (permission-aware; without permission "Ask an admin with <module> permission…") |
| Specific text | "No <things> yet" (lifecycle hasn't produced data) vs "No <things> found" (search/filter miss); sentence case |
| Feature not set up / preview unavailable | an invitation: soft icon, short title, one-line hint, one action — never an error look (`daaddf5a85`) |

No illustrations. No emoji except the single generic `Empty` line.

## 8. Errors, not-found, access denied

- One root `ErrorBoundary` per app (`RootErrorBoundary`, the "VOID//SYS" screen). Don't add
  per-route boundaries.
- Loader not found: `throw notFound("…")`. Load failure: `throw redirect(listPath, await
  flash(request, error(err, "Failed to load X")))`.
- No permission: `requirePermissions` redirects home with an "Access Denied" toast. Don't
  build 403 pages.
- Inline: field errors, `Alert variant="destructive"` in modals, table cell `ring-red-500`.
- A failed load must never render as "empty" (`e59a9e26e2`).

## 9. Disabled, read-only, locked, plan-gated

- **Locked:** `is{Entity}Locked(status)` in `{module}.models.ts` → `isDisabled`; server
  `requireUnlocked` (`apps/erp/app/utils/lockedGuard.server.ts`); exit via "Reopen" in ⋯. Fields
  render disabled, nothing hidden, no banner. Released revisions may add `LuLock` inside the
  status badge.
- **No permission:** disabled controls, not hidden (exception: empty-state CTAs hide).
- **Visuals:** `opacity-50` + `cursor-not-allowed` (Button/Input), `pointer-events-none` while
  loading; menu items `data-[disabled]:opacity-50`.
- **Plan gating:** `UpgradeOverlay` (`components/UpgradeOverlay/UpgradeOverlay.tsx`) — the real
  UI rendered blurred and inert with a centered upgrade card. Variants Section/Inline/
  StickyGradient/Dialog. Don't hide gated features.

## 10. Interactive state classes

| State | Class |
|---|---|
| Focus (fields, badges, tabs, checkbox, cards) | `focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50` |
| Focus (Button) | built in (blue offset halo) — reuse Button |
| Focus-within (groups) | `focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50` |
| Menu keyboard highlight | `focus:bg-accent focus:text-accent-foreground` (primitives) |
| Open trigger | `data-[state=open]:bg-accent` |
| Hover (neutral) | `hover:bg-accent` or `hover:bg-muted`; table rows `group-hover:bg-muted` (built in) |
| Hover (ghost button) | built in `hover:bg-primary/10` |
| Press | `active:scale-[0.96]` (Button) |
| Selected row (explorer/list) | base `hover:bg-accent/30`, selected `bg-accent/60 hover:bg-accent/50` |
| Selected table row | `data-[state=selected]:bg-muted` |
| Selected card / choice | `border-primary ring-2 ring-primary/20` |
| Selected tab | segmented: `bg-background` + shadow on a `bg-muted` tray (Tabs primitive) |
| Selected nav | `bg-active` / `variant="active"` |
| Invalid | `border-destructive`, `aria-invalid` |
| Disabled | `disabled:opacity-50 disabled:cursor-not-allowed` |

Selected state is a **tinted background**, never a saturated fill or a colored left border.
Always `focus-visible:`, never bare `focus:` rings.
