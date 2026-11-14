# Remembered table filters vs. preset sidebar links

Last tested: 2026-11-12
Route: /x/inventory/receipts

A sidebar link that carries its own `?filter=` (Inventory → Shipping & Receiving →
Pending inspection / Ready for putaway / Inspection failed) must not overwrite
the receipt table's remembered filters, and plain "Receipts" must restore the
user's own filters, not the preset's.

## Prerequisites
- Signed in (`/auth`). No data needed: the URL and localStorage are the result.

## Steps
### 1. Clear remembered state
On any `/x` page: `Object.keys(localStorage).filter(k => k.endsWith(':receipt')).forEach(k => localStorage.removeItem(k))`
### 2. Preset then plain
Open `/x/inventory/receipts`, click sidebar "Inspection failed", then sidebar "Receipts".
Expect: URL ends `/x/inventory/receipts` (no filter); storage holds no filters.
### 3. Own filter survives a preset
Open `/x/inventory/receipts?filter=status%3Aeq%3ADraft` (storage now `["status:eq:Draft"]`).
Click sidebar "Inspection failed" (URL has only the inspection filter; storage still Draft),
then sidebar "Receipts". Expect: URL `?filter=status%3Aeq%3ADraft`.
### 4. Same with "Pending inspection".

## Selector Notes
- Click the SIDEBAR link: `document.querySelectorAll('[data-nav-item] a')` matched by text.
  The first `a` with text "Receipts" is the breadcrumb, which carries no
  `restoreRememberedTable` state and so never restores anything; a test that clicks it
  passes without proving the fix.
- Storage key: `carbon:table:{userId}:{companyId}:receipt`; read `JSON.parse(v).filters`.

## Common Failures
- Without the fix, step 2 lands on `?filter=inspectionStatus%3Ain%3AInspection+Failed`.
- Starting the ERP dev server regenerates `packages/database/src/swagger-docs-schema.ts`;
  restore it with `git checkout` before committing.
