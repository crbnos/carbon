# Planning: past Start By refusal, reschedule from today, settle by quantity

Last tested: 2026-11-06
Routes: /x/production/planning, /x/purchasing/planning (drawer: `?location=<id>&item=<itemId>`)

## Prerequisites
- Open Make / Order planning actions, some with `latestOrderDate` before the
  location's today (`location_today`; the demo locations are America/Chicago,
  so "today" can be a day behind an Asia-zone clock).
- A Make item that is NOT `itemReplenishment.requiresConfiguration` (a
  configured product refuses the whole Make with "Manufacturing requires
  configuration" — not this feature).
- A Buy item with a supplier part (factor 1 keeps the numbers simple).
- Find data:
  `select pa.id, i."readableIdWithRevision", p."startDate", pa."suggestedQuantity", pa."latestOrderDate" from "planningAction" pa join item i on i.id=pa."itemId" join period p on p.id=pa."periodId" where pa.type='Make' and pa.status='Open' order by pa."latestOrderDate";`

## Steps
### 1. Drawer — reschedule and Start By
Open the drawer by URL. A late row's Start By is red with a "Reschedule from
today" icon button; clicking it sets Start By = today, Due = today + lead time,
and the button disappears. Clicking a Start By cell opens a date editor seeded
with the row's start date; typing a day moves Due by the lead time.

### 2. Make / Order with a late row
Leave one late row, lower another row's quantity, click Make / Order (JS click,
see notes). Expect: only the non-late rows created; the drawer stays open with
the late row; toast "N created. M orders start before today…". DB: the late
row's action unchanged; the lowered row's action Open at suggested − ordered.

### 3. Reload — remainder persists
Reopen the drawer: Suggested shows the late row and the remainder. Reschedule
the late row (its due date lands in another week) and Make: its action is
Actioned (matched by `planningActionId`), the other week's action unchanged.

### 4. Open Jobs due date on an ASAP job
Edit a Draft / Planned ASAP job's due date in Open Jobs: `job.deadlineType`
becomes Soft Deadline.

### 5. Bulk Create Jobs
Select rows (checkboxes), open the "<count>" button left of Filter, choose
"Create Jobs". Late-only rows are refused (their actions stay Open), the rest
created; two toasts ("N jobs created" and the refusal).

## Selector Notes
- Drawer Make / Order button is partly covered by a floating corner widget:
  click it with `eval` — `[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.trim()==='Make').click()`.
- Date cell editor: `spinbutton "day, Date"`; click it, `press` the digits,
  then click the drawer heading to leave. NEVER press Escape outside the cell:
  it closes the drawer and drops the drafts.
- Quantity cell editor is an unnamed `textbox`; `fill`, then click the heading.
- Use an isolated `AGENT_BROWSER_SESSION`: other worktrees' agents share the
  default daemon and take over its tab.

## Common Failures
- The order POST can take 20–30 s on a busy dev stack; poll the snapshot for
  the toast and re-read the DB after it lands.
- "Failed to load stock" toast on some Buy items: the item forecast route's
  `.single()` stock read gets several rows (PGRST116). Unrelated to ordering.
