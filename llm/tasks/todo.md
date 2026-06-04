# Rework Feature Implementation

Plan: `llm/tasks/rework-plan.md`
Design: `llm/tasks/rework-design.md`

## Tasks

- [x] Task 1: Database Migration — rework table, reworkId on jobOperation, views, RLS, completion trigger
- [x] Task 2: Trigger Rework Edge Function — path resolution, clone ops, wire DAG, trigger reschedule
- [x] Task 3: Upstream Operations Service + API Route — getUpstreamOperations(), rework-targets loader
- [x] Task 4: MES Trigger Rework Action Route — validator + action calling edge function
- [ ] Task 5: ReworkModal Component — modal with target picker, reason, quantity
- [x] Task 6: Wire ReworkModal into JobOperation — replace QuantityModal for rework
- [ ] Task 7: Manual Testing — verify full rework flow end-to-end

---

# Task: Refine long/short description UX on items

Follow-up on the long-description feature. Two UI asks:
1. Long description (inline in item Properties panels) is hard to read in a single-line field → add ellipsis + hover tooltip to reveal full text.
2. Short description's 40-char limit shows no "max count" error → show a red validation error when exceeded.

## Key findings (verified)
- `InputControlled` inline already truncates via `line-clamp-1` (InputControlled.tsx:101); just lacks a tooltip. `TruncatedTooltipText` (@carbon/react) shows a tooltip only when text is actually truncated.
- `InputControlled` inline `onBlur` already runs `validate()` and only saves/collapses when there's no error → adding `.max(40)` to the field validator surfaces the red error automatically and blocks the invalid save.
- BLAST RADIUS: shared `itemValidator`/`partValidator`/`toolValidator`/`consumableValidator`/`materialValidator` are reused by MCP API tools, `api/item.$type`, etc.; CSV import has no length cap. Capping shared validators at 40 would break external integrations → 40 stays a UI-only concern (backend 255).
- Materials deliberately have NO 40 cap (auto-generated names can exceed 40) → leave materials alone.

## Plan
- [ ] Part 1 — Long description ellipsis + hover tooltip (opt-in, zero impact on other fields). Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
  - [ ] Add optional `truncatedTooltip?: boolean` to `InputControlled`; wrap inline value in `TruncatedTooltipText` with `enabled={truncatedTooltip}` (disabled → identical current behavior).
  - [ ] Pass `truncatedTooltip` from `ItemDescription.tsx`.
- [ ] Part 2 — Short description max-40 error in Properties inline name fields (client-only local validators; safe). Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
  - [ ] PartProperties.tsx / ToolProperties.tsx / ConsumableProperties.tsx: remove `maxLength={40}`; local validator `name: z.string().max(40, { message: "Short description cannot exceed 40 characters" })`.
  - [ ] Materials: leave unchanged.
- [ ] Decision: leave create/edit forms hard-capped via `maxLength={40}` + helperText (validators shared with MCP/import; unsafe to cap). Offer form-specific client validators as a follow-up if wanted.
- [ ] Verify behavior + typecheck touched files.

## Review
Done. Files changed:
- `packages/form/src/components/InputControlled.tsx` — added optional `truncatedTooltip` prop; inline value now rendered via `TruncatedTooltipText` with `enabled={truncatedTooltip}` (default off ⇒ existing fields unchanged).
- `apps/erp/.../Item/ItemDescription.tsx` — passes `truncatedTooltip` ⇒ long description truncates with ellipsis and reveals full text on hover when clamped.
- `apps/erp/.../{Parts,Tools,Consumables}/*Properties.tsx` — removed silent `maxLength={40}`; local inline validator now `name: z.string().max(40, { message: "Short description cannot exceed 40 characters" })` ⇒ red error on blur + blocks the invalid inline save.

Deliberately left alone:
- Create/edit forms keep `maxLength={40}` + `Max 40 characters` helper. Their validators (`itemValidator` & co.) are shared with MCP tools / `api/item.$type` / CSV import; capping those at 40 would break external integrations (backend intentionally allows 255).
- Materials uncapped (auto-generated names can exceed 40).

Verified: `@carbon/form` and `erp` typecheck pass (tsgo --noEmit, exit 0, 0 errors).

Possible follow-up if wanted: give the create/edit forms the same "error when exceeded" via form-only client validators (keeping the shared backend validators at 255).

## Round 2 — bug fix + textarea + counter
1. BUG (long description not saving from the form): root cause was the `item` INSERT in every `upsert*` CREATE branch explicitly listed columns and omitted `description` (UPDATE branches already included it; the `get_*_details` RPC read path already returns it). Fixed by adding `description: X.description` to the create inserts in `items.service.ts`: upsertPart, upsertConsumable, upsertMaterial (both sizes/no-sizes), upsertTool. Caveat: items created BEFORE the fix have no description (re-save via edit fixes them; update path always worked).
2. Long description is now textarea-based: rewrote `ItemDescription.tsx` as a two-state inline editor — not-editing shows a `line-clamp-3` multi-line preview wrapped in `TruncatedTooltipText` (multi-line ellipsis + hover tooltip); editing swaps in `TextAreaControlled`, saving onBlur. No longer uses `InputControlled`.
3. Short-description feedback changed from error → live `X/40` counter: added a `characterLimit` prop to `Input` + `InputControlled` (mirrors `TextArea`'s counter; safe `characterLimit ?? maxLength` fallback so other fields are unaffected). Wired into the 4 forms (replacing `maxLength`+`Max 40 characters` helper) and the 3 Properties name fields (reverted the `.max(40)` error validator back to `z.string()`). Reverted the dead `truncatedTooltip` prop from `InputControlled`.

Verified: `@carbon/form` + `erp` typecheck pass (tsgo --noEmit, exit 0). Behavioral check (create a new item w/ long description → persists; counter shows 0/40) requires the running dev server — no DB rebuild needed (service code + existing RPC).
