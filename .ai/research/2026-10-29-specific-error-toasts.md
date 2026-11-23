# Research: how error toasts reach the user today

Worktree: carbon-feat-specific-error-toasts @ a0b64a87cb (2026-10-29). Evidence gathered by a read-only sweep; file:line cited.

## Two server error systems
- **Legacy `error(cause, msg)`** — `packages/auth/src/utils/result.ts:10-23`. Logs the cause, returns only `{success:false, message}`. Cause is dropped.
- **Service fns `ctx.error(category, msg, cause)`** — `packages/api/src/service-fn.server.ts:42-62` (`CarbonError`, "message is for the user; cause is logged, never shown"). `internal` refusals run through `refusalFromDatabase` (:437-450) → `databaseRefusal` maps known SQLSTATEs to `"<msg>: <specific>"`. Client gets `{error:{category,message,status}}` via `toResult` (:466-476).

## Delivery paths
- Redirect + `flash()` → cookie (`packages/auth/src/services/session.server.ts:297-319`) → root loader `result` → `packages/auth/src/middleware/flash.client.ts:14-31` calls `toast.error(message, {description})`.
- `Result.description` (`packages/auth/src/types.ts:64-70`) is wired end-to-end to the toast's second line but **no call site sets it**.
- Fetchers: `useAction` (`packages/query/src/useAction.ts:35-82`) toasts `data.error.message` for service-fn shapes only; legacy `{success:false,message}` left to each component.
- `respond(...).redirect` (`packages/api/src/carbon.server.ts:113-132`) flashes `error(null, result.error.message)`.

## Translation
- Server messages are never translated (no Lingui in packages/auth or packages/api; flash.client passes raw string).
- Client `toast.error(t\`...\`)` is Lingui-translated (270 sites).
- Precedent for translating a server-sent descriptor on the client: `apps/erp/app/modules/settings/ui/Integrations/IntegrationCard.tsx:114` `i18n._(failure.description)`.

## Call-site counts (rg, -t ts, no tests)
| Area | `error(` | `toast.error(` | flash+error | `ctx.error(` |
|---|---|---|---|---|
| erp | 1500 | 473 | 586 | 1350 |
| mes | 150 | 46 | 78 | 0 |
| academy | 17 | 2 | 8 | 0 |
| starter | 21 | 2 | 10 | 0 |
| packages | 32 | 20 | 1 | 6 |

- `ctx.error` categories: internal 680 (595 start "Failed to…"), rule 314, notFound 189, validation 63, conflict 61, forbidden 20, other ~18.
- First arg of `error()`: ~64% Supabase `.error` (PostgrestError), ~20% `null`, ~3.5% caught `err`, ~47 zod, **50 pass `params` by mistake** (e.g. `apps/erp/app/routes/x+/items+/uom.delete.$uomId.tsx:77`).
- Client `toast.error`: ~58% fixed strings (cause discarded), ~128 already use `.message`.

## Existing "make it specific" helpers
- `packages/api/src/database-refusal.ts` `databaseRefusal()` — maps 23505 (already exists), 23503 (still used / doesn't match), 23502 (required), 23514 (breaks rule), 22xxx (bad value), 42501 (permission), PGRST116 (not found). **No P0001 (RAISE EXCEPTION) mapping.**
- `packages/api/src/service-tools.server.ts:163-180` `serviceRefusal` (used by `unwrap`/`run`) — shows P0001 text as-is.
- `packages/api/src/errors.ts` — `RAISED_EXCEPTION`, `isDataLayerError`, zod summary "Invalid input — path: msg".
- `packages/utils/src/errors.ts` — `getErrorMessage` (76 uses), `getDatabaseErrorMessage` (31 uses, mostly delete routes).
- Hand-written specific messages exist in ~20 places (e.g. `apps/erp/app/routes/x+/items+/delete.$itemId.tsx:30-60`, `sales-order+/new.tsx:83-93`).

## Gaps that produce generic toasts
1. Legacy `error(pgErr, "Failed to …")` (≈1076 sites) — no mapping at all; cause only logged.
2. Service-fn `ctx.error("internal", …, err)` — P0001 / 55000 trigger messages swallowed.
3. RAISE with ERRCODE 23514/23503/42501 is mapped by code and loses its authored text.
4. Client fixed-string `toast.error` (~314) — cause discarded (e.g. `DefaultAttachmentsPanel.tsx:104`).
5. RLS-blocked updates (USING-only policies, e.g. purchaseOrder) return 0 rows and no error — silent or PGRST116.
6. No request id in any toast, though `x-request-id` exists (`packages/logger/src/middleware.server.ts:149-200`).

## Database side
- 442 `RAISE EXCEPTION` in 108 migration files; mostly user-readable ("Accounting period is closed for posting date %"), some developer-facing ("journalDimensionPivot requires p_company_id", ids in text).
- ERRCODEs: 55000 ×61, insufficient_privilege ×31, check_violation ×12, 42501 ×11, others small.

## Toast component
- sonner 2.0.7 via `packages/react/src/Toast.tsx`; supports `description` (second line). Not verified: contrast of muted description on red error toast.
