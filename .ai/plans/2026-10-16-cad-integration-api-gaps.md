# CAD integration API gaps

From an integrator's review (a CAD program pushing parts, BOMs and models into
Carbon). Gap 4 (per-app credentials) and the NC-program field are out of scope.

## 1. Create a 3D model through the API

The uncommitted item-only pair (`createItemModelUploadUrl` / `attachItemModel`)
signed into the company bucket (50 MB cap) and attached to items only.

- [x] `items_createModelUploadUrl` — signs into `temp-staging` (2.5 GB, where the
      browser stages raw CAD) at `${companyId}/models/${modelId}.${ext}`.
- [x] `items_insertModelUpload` — records the upload, attaches it to at most one
      of item / job / sales RFQ line / quote line / sales order line, optional
      `convert` (STEP → `assembly-convert`), always `model-optimize`.
- [x] `api+/model.upload.ts` calls `insertModelUpload` (one path; the route keeps
      the assembler health check).
- [x] Manifest digest regenerated.

## 2. Signed webhooks

- [x] Migration: vault-backed per-webhook signing secret
      (`get_webhook_signing_secret` get-or-create, `rotate_…`, `delete_…`,
      service role only).
- [x] Delivery signs the exact body: `Carbon-Signature: t=<unix>,v1=<hex>`,
      HMAC-SHA256 over `${t}.${body}`, keyed by the secret string. Pure helper +
      tests in `webhook-body.ts`.
- [x] ee: `getWebhookSigningSecret` (runtime) / `revealWebhookSigningSecret` /
      `rotateWebhookSigningSecret` (`requireEntitlement`); the secret is dropped by
      `sync_webhook_subscription` when the webhook row is deleted.
- [x] Settings → Webhooks edit drawer: reveal + roll.
- [x] Docs: replace "treat the URL as the secret" with verification.

## 3. Webhooks for methods and models

- [x] `webhookTable` rows: makeMethod, methodMaterial, methodOperation, modelUpload,
      plus changeOrder / changeOrderAffectedItem (asked for by the hotice session; both
      already emit events).
- [x] `attachments.ts`: `events: true` for makeMethod, methodOperation, modelUpload;
      generated authz migration.
- [x] Docs table.

## Verification

Static: erp / ee / jobs typecheck, jobs + checks + content tests (the two jobs
`*.database.test.ts` files point at another database and were not run), Biome,
the `authz` migration test, the conformance gate.

Live, on the worktree stack (2026-10-17), with test data removed afterwards:

1. `crbn up` applied the 3 migrations. `authz check` reports no drift. The types
   carry the 3 functions.
2. The secret functions, in a rolled-back transaction: get creates the secret once,
   rotate replaces it, a wrong company gets null, `anon` / `authenticated` get the
   guard error. Deleting the webhook removes the secret and the subscription.
3. A key scoped to `parts_*` called `items_createModelUploadUrl` over `/api/v1`, PUT a
   STEP file to `temp-staging`, then called `items_insertModelUpload` with an
   `itemId` and `convert`. The item got the model. `model-optimize` and
   `assembly-convert` were sent.
4. `api+/model.upload.ts`, called with the browser session and two targets (a sales
   order line and its item), linked both.
5. A `makeMethod` webhook delivered a signed UPDATE to a local receiver. The
   verifier on the docs page accepts it, and refuses a changed body, a wrong secret
   and an old `t`.
6. Settings → Webhooks: Reveal shows the Vault secret. Roll asks to confirm, shows
   the new secret, and keeps the drawer open. The next delivery verifies with the
   new secret.

Left for the commit: `lingui:extract` for the new strings.
