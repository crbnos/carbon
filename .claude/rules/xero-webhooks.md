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
2. **Fail closed when unconfigured**: if `XERO_WEBHOOK_SECRET` is unset, log an error
   and return `401` `{ success: false, error: "Webhook secret not configured" }` before
   anything else — without the key a Xero delivery cannot be told from anyone else's,
   and every event queues a sync job.
3. **Intent-to-receive short-circuit**: if the body is empty / `"{}"`, return `200`
   with an empty body.
4. **Signature check**: read the `x-xero-signature` header. Missing → `401`
   `{ success: false, error: "Missing signature" }`. Mismatch → `401`
   `{ success: false, error: "Invalid signature" }` (see `verifySignature` below).
5. `JSON.parse` the body (parse failure → `401`), then validate with `WebhookSchema`
   (zod). Invalid shape → `401`.
6. Group events by `tenantId`. Per tenant: `getAccountingIntegration(serviceRole,
   tenantId, ProviderID.XERO)` to resolve the `companyId`; missing → record an error and
   `continue`. **Tenant binding**: the resolved row is trusted only when its OWN stored
   tenant (`getStoredTenantId` → `parseStoredCredentials(...).providerMetadata.tenantId`)
   equals the event's `tenantId` — `getAccountingIntegration` also matches on
   `companyId`, so an event naming a company id instead of a tenant would otherwise
   resolve that company. A mismatch records the same "Tenant ID not found in
   integrations" error and `continue`s. Then `getProviderIntegration(...)` builds a
   live `XeroProvider`.
7. For each event, **fetch the entity from Xero** to refine its type, build
   `AccountingEntity[]`, and if non-empty fire one background job per tenant via
   `trigger("sync-external-accounting", payload)`.
8. Return a plain object summary `{ success, jobsTriggered, jobs, errors?, timestamp }`
   (HTTP 200). `success` is `errors.length === 0`.

## Signature verification (`verifySignature`)

- `verifySignature(payload, header, secret)` returns a boolean: HMAC **SHA-256** of the
  raw `payloadText` keyed by `XERO_WEBHOOK_SECRET`, digest **base64**, compared to the
  header via `crypto.timingSafeEqual` (unequal lengths are a mismatch, not a throw).
- **Fail-closed when unconfigured**: the action returns `401` before verification when
  `XERO_WEBHOOK_SECRET` is unset (step 2). The env var is still declared optional
  (`getEnv("XERO_WEBHOOK_SECRET", { isRequired: false, isSecret: true })` in
  `packages/env/src/index.ts`) so an instance without Xero boots; it just cannot
  receive Xero webhooks.

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

- Verification is **fail-closed**: no `XERO_WEBHOOK_SECRET` = every delivery is `401`.
- Validation/parse failures return **401** (not 400) — only the intent handshake and the
  fully-processed case return 200.
- The route fans out extra synchronous Xero GETs per event before responding.
- `getAccountingIntegration` resolves by `companyId` first, then by the stored tenant
  (`metadata->credentials->>tenantId` or `metadata->credentials->providerMetadata->>tenantId`,
  each a separate parameterised `.eq()`; more than one company on one tenant resolves
  to nothing). Because a company-id match also succeeds, the route re-checks the
  resolved row's own tenant against the event (step 6).
- Only `CONTACT` and `INVOICE` categories are accepted by the schema; any other category
  fails zod validation → 401.
