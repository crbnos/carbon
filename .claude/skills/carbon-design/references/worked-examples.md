# Worked examples — reasoning like a Carbon designer

These show the *reasoning*, not code to copy. Each walks the workflow from `SKILL.md`:
classify → find the sibling → reuse / extend / create → brief → review. Use them to calibrate
how much of Carbon's existing language a new feature should inherit.

---

## Example 1 — A new lookup: "Hold Reasons" for sales orders

**Request:** planners want to put a sales order on hold with a reason from a company-defined
list.

**Classify.** Two things: a *lookup collection* (hold reasons) and a *state change on a
document* (hold/release a sales order).

**Siblings.** Lookup: Customer Types / Return Reasons (archetype G). State change: Cancel
Sales Order (`CancelSalesOrderModal.tsx`) and the SO header.

**Decisions.**
- Hold reasons live in the Sales sub-nav **Configure** group (not Settings): table whose first
  column is `Hyperlink → Enumerable`, drawer via `hold-reasons.new.tsx` / `$id.tsx` /
  `delete.$id.tsx`, `HoldReasonForm` written with `ModalDrawer` so the selector can create one
  inline (`type="modal"`). A `HoldReason` domain selector copied from `components/Form/Customer.tsx`.
- "On Hold" is a lifecycle position → add it to `SALES_STATUS_COLOR_MAP`. Held = waiting on
  someone → **yellow** (clock). Not orange (not being worked) and not red (not dead).
- "Put on Hold" is a rare, reversible transition → it goes in the header ⋯ menu, not as a
  visible button. It opens a `Modal` ("Hold Sales Order", reason selector + optional note,
  `[Cancel][Hold]`). While held, the next-step primary (Ship/Invoice) is disabled, and "Release
  Hold" becomes the header's primary.
- Held orders are locked like other statuses (`isSalesOrderLocked`) — fields disabled in place,
  no banner. The reason shows in Properties as a read-only field and in the status tooltip.
- List: status filter already covers it; add a "Hold Reason" column hidden by default.

**Rejected:** a red "ON HOLD" banner across the page (loud, and duplicates the status pill); a
toggle switch in Properties (a lifecycle event must be explicit, with a reason).

---

## Example 2 — A novel component: lot genealogy timeline

**Request:** on a tracked lot, show where it came from and where it went (received → split →
consumed into a job → shipped), in order.

**Classify.** New visualization inside an existing record page (tracked entity). No existing
component shows an ordered, branching history. `Activity` is close (a feed) but has no notion
of quantity flow; the traceability graph is a full-screen canvas.

**Decision: create, in Carbon's language.** A `LotTimeline` component in the module's `ui/`
(domain-aware → not `packages/react`), rendered inside a `Card` titled "Genealogy" in the
content pane.
- Each event row mirrors `Activity`'s grammar: small leading icon (`Lu*`, muted; hue only for
  a failed/scrapped event), **readable IDs as `Hyperlink`s** (receipt, job, shipment), quantity
  with unit and `tabular-nums` ("40 EA of 120"), the actor as `EmployeeAvatar`, time as
  `DateTime variant="relative"`.
- Connectors are 1px `border-border` lines, not colored arrows. Branches indent with the
  `TreeView` `LevelLine` spacing so it rhymes with BoM trees.
- Statuses of linked documents use their existing `*Status` wrappers.
- Empty: `Empty` with "No movements yet". Loading: skeleton rows of the same height.
- Long histories: render at natural height (no inner scroll); collapse sub-branches behind a
  chevron.

**Rejected:** a colorful horizontal stepper with big circles (generic SaaS, low density, can't
branch); a new color per event type (hue without meaning).

---

## Example 3 — Surfacing a blocking condition: customer credit hold

**Request:** when a customer is over their credit limit, confirming a new sales order should be
blocked unless a manager overrides.

**Classify.** A fact about a party record + a guard on a document transition.

**Siblings.** Party record header (`CustomerHeader.tsx` `CardAttributes`), SO header
transitions, `QuoteFinalizeModal` (Alert inside a modal for a blocking condition).

**Decisions.**
- On the customer: credit limit and current exposure are *metadata* → `CardAttributes` in the
  customer header card; exposure over limit shows a `Badge variant="red"` "Over Limit" next to
  the value (hue only because it means something). No banner on the customer page.
- On the SO: the Confirm button stays the primary (it *is* the next step). Clicking it opens
  the usual confirm modal, which shows `Alert variant="destructive"` "Customer over credit
  limit" with the numbers (currency formatter) and, for users with the override permission, a
  destructive-styled "Confirm Anyway". Without permission the confirm button is disabled with a
  tooltip explaining why.
- The server enforces the same rule (flash "Customer is over their credit limit" on violation).
- Copy is consequence-first and exact: "Exposure $12,400 of $10,000 limit."

**Rejected:** hiding the Confirm button (breaks the header shape, P9); a toast after the fact
(the user needs to decide *before* acting); amber text on the SO header (P1).

---

## Calibration notes

- Most of each design came from **existing parts** (archetypes, overlays, Status, Enumerable,
  Hyperlink, DateTime). New surface area was small and justified.
- Each new element was checked against a *reason*: lifecycle position for colors, record rank
  for containers, frequency for action prominence.
- Each example says what was **rejected** and why — include that in your own briefs.
