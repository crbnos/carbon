# oRPC completion — live smoke (T9)

Stack: `crbn up` on branch `feat/carbon-api-orpc`, ERP dev server at 127.0.0.1:57011.
Keys: two throwaway `apiKey` rows minted directly in the dev DB (scoped:
`sales_view/create/update` for the company; unscoped: `{}`), deleted after the run
along with the test record.

## HTTP surface (`/api/v1`)

| Check | Expected | Got |
|---|---|---|
| `POST /api/v1/sales/getCustomers`, scoped key | 200, unwrapped `{data:[…]}` | 200 ✓ (real customer rows) |
| same, unscoped key | 403 | 403 ✓ |
| `POST /api/v1/settings/seedCompany` (blocked) | 404 | 404 ✓ |
| `POST /api/v1/sales/nope` (unknown) | 404 | 404 ✓ |
| `GET /api/v1/openapi.json` `.paths | length` | 1495 | 1495 ✓ |
| 70-request flood, scoped key | trailing 429s | 200×~48 then 429s ✓ (60/min window shared with earlier calls) |
| 429 headers | X-RateLimit-* + Retry-After | `retry-after: 8`, `x-ratelimit-limit: 60`, `x-ratelimit-remaining: 0`, `x-ratelimit-reset` ✓ |

## MCP surface (`/api/mcp`, JSON-RPC)

| Check | Got |
|---|---|
| `call_tool sales_getCustomers`, scoped key | customer JSON array, unwrapped, `isError` unset ✓ |
| same, unscoped key (**D6 behavior change**) | `isError: true`, text `Error: API key lacks the required scope: sales_view` ✓ |
| `search_tools {query:"customer contact"}` | 5 tools, module-grouped output unchanged ✓ |
| `describe_tool` | responds (note: `sales_upsertCustomerContact` does not exist; contact writes are `insert`/`updateCustomerContact`) |
| `call_tool sales_upsertCustomerStatus _operation:create` | created `cs_VoeWxqy1Fk25ngVvxvZ7p7`; DB row `createdBy` = the key's user ✓ |
| `_operation:update` with forged `createdBy:"forged-user"` | name updated, `createdBy` UNCHANGED (forgery stripped) ✓; output text `null` matches the D4 contract |

## API-key cache (T2 measurement, deferred here)

Fresh key, 5 requests: all 200; `apikey:auth:<keyHash>` present in Redis with the
full record and TTL 29 (one 30s SET on the first request; the rest were cache hits).

## Build

`pnpm --filter erp build` exit 0 — `react-router:dot-server` accepts the
`agent.tools.ts` → `call.server` import (grounding fact 6 proven; Task 6 escape
hatch unused).
