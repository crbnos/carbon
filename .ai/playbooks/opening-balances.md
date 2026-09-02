# Opening Balances (inline on Chart of Accounts)

Last tested: 2026-09-01
Route: /x/accounting/charts (no standalone page — the earlier /x/accounting/opening-balances screen was removed)

## Prerequisites
- Accounting enabled (/x/settings/accounting) — the balance column and the "Opening Balances" button only show when enabled.
- A Retained Earnings default account set at /x/accounting/defaults (seed demo has `3100 Retained Earnings`).
- No un-reversed posted `Opening Balance` journal entry — otherwise the "Opening Balances" button is hidden (reverse the JE to re-enable).

## Steps
### 1. Navigate — /x/accounting/charts
Expect the Chart of Accounts tree + a primary "Opening Balances" button in the toolbar (next to New Group / New Account).
### 2. Enter mode — click "Opening Balances"
Add Group / Add Account disappear; Cancel + Post appear; the balance column header becomes "Opening Balance"; each **leaf** account row's balance cell becomes a right-aligned numeric input (group rows show no input); the per-row actions menu is hidden.
### 3. Fill — type an amount into an account's input, then BLUR (click another input) so react-aria commits. Positive = the account's natural side (Asset/Expense → debit; Liability/Equity/Revenue → credit). Post enables once at least one non-zero amount exists.
### 4. Post — click "Post" → a centered modal "Post opening balances" opens with an "As of date" DatePicker (defaults to company today). `requestSubmit` the modal's form (button text "Post", NOT a click).
### 5. Verify — redirects to /x/journal-entry/{id}/details: Source "Opening Balance", status POSTED, your line(s) + an auto Retained Earnings plug line, Totals BALANCED.
### 6. Guard — back on /x/accounting/charts the "Opening Balances" button is now hidden (a posted entry exists). Reverse the JE (JE detail → ⋮ More options → Reverse Entry → confirm) to make it appear again.
### 7. Cancel — clicking Cancel in opening-balance mode discards entered amounts and returns to the normal tree (inputs gone, Add buttons back).

## Selector Notes
- Leaf-account inputs render as `textbox` refs showing `$0.00`; the first is the first leaf account in the tree.
- Toolbar buttons: "Opening Balances" (enter), then "Cancel" / "Post" once in mode.
- Modal Post button: `button[type=submit]` text "Post" inside the modal's form. Use `f.requestSubmit(b)`.

## Common Failures
- "Opening Balances" button missing: accounting disabled, no create-accounting permission, or an un-reversed posted Opening Balance entry already exists.
- Post modal submit does nothing: clicked instead of `requestSubmit`, or the number input's onChange never fired (fill + blur).
- Vite "Cannot find module": after adding/removing route or ui files, `touch` the changed file or reload so Vite re-resolves.
