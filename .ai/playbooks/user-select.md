# User Select (groups + people picker)

Last tested: 2026-07-14
Route: any form with a `<Users>`/`<UserSelect>` field — easiest: /x/settings/approval-rules/new?type=purchaseOrder ("Who Can Approve"), /x/users/groups/new (GroupsForm, verbose mode), bulk Edit Permissions from /x/users/employees (usersOnly mode).

## Prerequisites

- Logged in via /auth (test@carbon.ms).
- Seeded dev company has 2 employee groups (All Employees root + Admin). For pagination tests insert >25 parentless groups via psql (`INSERT INTO "group" ("name","companyId") SELECT 'Perf Test Group '||lpad(n::text,2,'0'), (SELECT id FROM company LIMIT 1) FROM generate_series(1,30) n;`) and DELETE them after. Raw-SQL fixtures do NOT invalidate the client cache — hard-reload the page to see them.

## Steps

### 1. Network assertions — patch fetch, don't use performance entries
Vite dev floods the resource-timing buffer (250 cap) before API fetches happen. Install:
`window.__apiLog=[]; window.__origFetch=window.fetch; window.fetch=(...a)=>{const u=String(a[0]); if(u.includes('/api/')) window.__apiLog.push(u); return window.__origFetch(...a)}`
The patch dies on full navigations (agent-browser open, some form submits) — reinstall after each.

### 2. Interacting with the select — use eval clicks, not @refs
The dropdown is an absolutely-positioned popover; a11y refs go stale across its re-renders and misclicks land on the drawer overlay (closing it). Reliable selectors:
- Input: `document.querySelector('[aria-haspopup=tree]')` → `.focus()` opens the dropdown and triggers page-0 fetch (`/api/users/select/groups?type=…&offset=0&limit=25`).
- Group rows: `[role=treeitem][data-expandable]`; row click = select (non-usersOnly) / expand (usersOnly). Header div is `:scope > div`.
- Chevron: `button[aria-label="Expand group"|"Collapse group"]` inside the row — expands without selecting; hover on a collapsed row prefetches members.
- Chips list: labels via `[...document.querySelectorAll('ul li p')].map(p=>p.textContent)`; buttons `aria-label="Expand <name>"` (explode) / `"Remove <name>"`.
- Wrapper form value: hidden inputs `input[name^="<fieldName>"]` (GroupsForm uses `selections[n]` with `user_`/`group_` prefixes).

### 3. Search
Type ≥2 chars with real key events (`keyboard type`) — synthetic `fill` doesn't always reach React state. One debounced `/api/users/select/search?q=…` request; flat Groups → People sections, group rows have the GROUP badge and no chevron. 1 char filters loaded pages client-side (no request). Clear via `button[aria-label="Clear search query"]`.

### 4. Approval rule save gotcha
`lowerBoundAmount` validator is `.gt(0)` and the currency field commits "0" — fill the visible amount input then blur (click another field), verify `input[name=lowerBoundAmount]` value, then `form.requestSubmit(createRuleButton)`. Also `/new` needs `?type=purchaseOrder` (documentType comes from the query param).

### 5. Verify
- Selection: chip appears; group row gets `aria-selected=true` without `aria-expanded` changing.
- Resolve: reopening a saved record fires ONE `/api/users/select/resolve?ids=…` and chips render with the dropdown closed.
- Invalidation: after group create/rename via the UI, the next select mount fires a FRESH page-0 request (no request = cache hit = invalidation broken).
- Infinite scroll: `tree.scrollTop = tree.scrollHeight` on `[role=tree]` → `offset=25` request; sentinel div (`justify-center` last child) disappears when hasMore=false.
- Group emails endpoint: `/api/users/select/groups/<id>/emails` → `{emails:[…]}`; foreign/unknown id → `{emails:[]}` (tenant guard).

## Selector Notes

- Bulk Edit Permissions: /x/users/employees → check a row checkbox → a count button ("1") appears top-left of the table → menu → "Edit Permissions" (the row-level Action Menu "Edit Permissions" opens the SINGLE-user page, not the usersOnly bulk form).
- Groups list has no "New Group" text button visible in a11y snapshots; navigate to /x/users/groups/new directly. Row edit links are `"<name> Open"`.

## Common Failures

- Clicks near the open dropdown hitting the drawer overlay → drawer closes, DOM queries return empty (looks like state was wiped). Always eval-click within the popover.
- `fill` on the select input with the same/empty value fires no React change — use `keyboard type` or the Clear button.
- Screenshots: agent-browser saves to ~/.agent-browser/tmp/screenshots/ regardless of the path arg — copy the newest file out.
