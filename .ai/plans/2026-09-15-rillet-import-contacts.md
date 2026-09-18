# Rillet: import customers and vendors

Add a **Import customers & vendors** action to the Rillet integration that pulls
Rillet Customers and Vendors into Carbon and records the
`externalIntegrationMapping` rows, so a later Carbon sales order / invoice pushes
onto the EXISTING Rillet customer instead of creating a duplicate.

## Why the mapping retention is (mostly) free

`RilletCustomerSyncer.upsertRemote` already calls `getRemoteId(localId)` first and
does a `PUT /customers/{id}` when a mapping exists — only a mapping-less local id
reaches `createCustomer`. Same for vendors. So linking on import is the whole job:
`BaseEntitySyncer.pullFromAccounting/pullBatchFromAccounting` call `linkEntities`
after `upsertLocal`, which writes the mapping row.

## Tasks

1. `providers/rillet/entities/shared.ts` — split `RilletEntitySyncer` (Rillet
   plumbing + structured-error push override) from a new
   `RilletPushOnlyEntitySyncer` that owns the four pull rejections.
   `RilletTransactionSyncer` extends the push-only one.
2. `entities/item.ts` — extend `RilletPushOnlyEntitySyncer` (unchanged behavior).
3. `entities/customer.ts` / `entities/vendor.ts` — extend `RilletEntitySyncer` and
   implement the pull half: pure `mapRilletCustomerToLocal` /
   `mapRilletVendorToLocal`, plus `upsertLocal` with the match ladder
   mapping → `carbon` external_reference → unique name, and a `fetchRemoteBatch`
   that indexes ONE cursor-drained list instead of N single GETs.
4. `providers/rillet/provider.ts` — document that customer/vendor stay
   `push-to-accounting` / `owner: "carbon"`: the import is an explicit
   `pull-from-accounting` ledger operation, and `owner: "carbon"` is what stops a
   re-import from clobbering a linked Carbon record.
5. `packages/jobs/.../integrations/rillet-import-contacts.ts` — new Inngest
   function: list customers + vendors, enqueue `pull-from-accounting` ledger
   operations in chunks, drain each chunk through `drainSyncOperations`.
6. `packages/lib/src/events.ts` + `trigger.ts` + `inngest/index.ts` — register the
   event and the function.
7. `apps/erp/app/routes/api+/integrations.rillet.import-contacts.ts` — POST
   endpoint (`update: "settings"`), verifies the integration is installed/active.
8. `packages/ee/src/rillet/config.tsx` — the `actions` entry (the button).
9. Tests: the pure mappers + the match ladder + the batch list indexing.

## Deliberately NOT done

- Addresses are not imported. Both the Xero and QBO pulls skip them, Carbon's
  `address.countryCode` is an FK to `country.alpha2` (a Rillet free-text country
  would fail the whole row), and a location needs a name Rillet does not carry.
- `direction` stays push-only, so no cron starts pulling contacts on its own.
