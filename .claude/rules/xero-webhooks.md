---
description: Inbound Xero webhook endpoint — signature/intent verification and how events queue the accounting sync job
paths:
  - "apps/erp/app/routes/api+/webhook.xero.ts"
  - "packages/ee/src/accounting/core/service.ts"
  - "packages/ee/src/accounting/providers/xero/**"
---

# Xero Webhooks

Inbound webhook from Xero notifying Carbon of Contact/Invoice changes. The single
handler is the **route** `apps/erp/app/routes/api+/webhook.xero.ts` (flat-route →
URL `/api/webhook/xero`, same pattern as `webhookStripe` in `path.ts`). It is a
React Router `action` only — there is no separate provider method. The stale claim
that `XeroProvider` has stubbed `verifyWebhook()`/`processWebhook()` to implement is
wrong: no such methods exist, and verification + processing are fully implemented
inline in the route.

The route runs on the **Node runtime** (`export const config = { runtime: "nodejs" }`)
because it uses `crypto` for HMAC.

## Receive → verify → process flow

1. `const payloadText = await request.text()` — read the **raw** body first; signature
   verification must hash the raw bytes, not re-serialized JSON.
2. **Intent-to-receive short-circuit**: if `XERO_WEBHOOK_SECRET` is set and the body is
   empty / `"{}"`, return `200` with an empty body immediately. This is how Xero's
   "Intent to Receive" validation handshake passes.
3. **Signature check**: read the `x-xero-signature` header. Missing → `401`
   `{ success: false, error: "Missing signature" }`. Present → `verifySignature()`.
4. `JSON.parse` the body (parse failure → `401`), then validate with `WebhookSchema`
   (zod). Invalid shape → `401`.
5. Group events by `tenantId`. Per tenant: `getAccountingIntegration(serviceRole,
   tenantId, ProviderID.XERO)` to resolve the `companyId`; missing → record an error and
   `continue`. Then `getProviderIntegration(...)` to build a live `XeroProvider`.
6. For each event, **fetch the entity from Xero** to refine its type, build
   `AccountingEntity[]`, and if non-empty fire one background job per tenant via
   `trigger("sync-external-accounting", payload)`.
7. Return a plain object summary `{ success, jobsTriggered, jobs, errors?, timestamp }`
   (HTTP 200). `success` is `errors.length === 0`.

## Signature verification (`verifySignature`)

- HMAC **SHA-256** of the raw `payloadText` keyed by `XERO_WEBHOOK_SECRET`, digest
  **base64**, compared to the header via `crypto.timingSafeEqual`.
- **Fail-open when unconfigured**: if `XERO_WEBHOOK_SECRET` is unset, `verifySignature`
  logs a warning and *returns the payload string* (truthy) — and the whole verification
  block in `action` is skipped anyway (`if (XERO_WEBHOOK_SECRET)`). So with no secret set,
  every request is processed unverified. The env var is declared optional
  (`getEnv("XERO_WEBHOOK_SECRET", { isRequired: false, isSecret: true })` in
  `packages/env/src/index.ts`).

## Event payload (`WebhookSchema`)

```jsonc
{
  "events": [{
    "tenantId": "...",
    "eventCategory": "CONTACT" | "INVOICE",   // only these two accepted
    "eventType": "CREATE" | "UPDATE" | "DELETE",
    "resourceId": "...",                       // Xero entity UUID
    "eventDateUtc": "..."
  }],
  "firstEventSequence": 0,
  "lastEventSequence": 0,
  "entropy": "..."   // optional
}
```

## Entity-type resolution (extra Xero API calls)

The webhook only carries `CONTACT`/`INVOICE`; the route calls back to Xero via
`provider.request("GET", ...)` to map to Carbon entity types before queuing:

- **CONTACT** → `fetchContactType` GETs `/Contacts/{id}`, reads `IsCustomer`/`IsSupplier`.
  `customer` → pushes a `customer` entity; `supplier` → `vendor`; **both flags** → pushes
  *two* entities (`customer` + `vendor`). Neither flag → skipped.
- **INVOICE** → `fetchInvoiceType` GETs `/Invoices/{id}`, reads `Type`:
  `ACCREC` (receivable) → `invoice`, `ACCPAY` (payable) → `bill`.
- `eventType` is lowercased into `AccountingEntity.operation` (`create|update|delete`).

These syncronous fetches mean the handler is **not** a fast ack-only endpoint; a slow
Xero API will slow the response.

## Queuing the sync (Inngest, not Trigger.dev)

`trigger(...)` from `@carbon/jobs` is an **Inngest** event send, despite a stale
"Trigger.dev" comment in the route. `trigger("sync-external-accounting", payload)` maps to
Inngest event `carbon/sync-external-accounting` (`packages/lib/src/trigger.ts`), handled by
`packages/jobs/src/inngest/functions/integrations/sync-external-accounting.ts`. Payload is
`AccountingSyncPayload`: `{ companyId, provider: ProviderID.XERO, syncType: "webhook",
syncDirection: "pull-from-accounting", entities, metadata: { tenantId, raw } }`. For the
downstream syncer architecture see `accounting-sync-handlers.md`.

## Gotchas

- Verification is **fail-open**: no `XERO_WEBHOOK_SECRET` = all requests trusted.
- Validation/parse failures return **401** (not 400) — only the intent handshake and the
  fully-processed case return 200.
- The route fans out extra synchronous Xero GETs per event before responding.
- `getAccountingIntegration` matches the tenant via `companyId` OR
  `metadata->credentials->>tenantId`, so the webhook's `tenantId` resolves the company.
- Only `CONTACT` and `INVOICE` categories are accepted by the schema; any other category
  fails zod validation → 401.
