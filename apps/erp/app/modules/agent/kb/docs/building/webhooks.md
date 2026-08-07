# Webhooks

> Get an HTTP callback when a Carbon record is created, changed, or deleted.

A **webhook** sends an HTTP `POST` to a URL you choose whenever a record in a subscribed table is inserted, updated, or deleted. It's the lightest way to react to Carbon in your own systems without polling the API.

## Subscribable tables

You subscribe a webhook to exactly one table. The tables you can watch, by module:

| Module | Tables |
| --- | --- |
| Sales | `customer`, `quote`, `salesOrder`, `salesRfq` |
| Purchasing | `purchaseOrder`, `supplier`, `supplierQuote` |
| Invoicing | `salesInvoice`, `purchaseInvoice` |
| Production | `job` |
| Inventory | `receipt` |
| Items | `item` |
| Users | `employee` |

For each webhook you choose which operations fire it (**insert**, **update**, **delete**), and at least one must be selected.

## The payload

Carbon `POST`s a JSON body to your URL. `type` is the operation, `record` is the affected row, and `old` carries the previous row on updates.

```json
{
  "type": "UPDATE",
  "table": "salesOrder",
  "companyId": "abc123",
  "eventId": "1042",
  "record": { "id": "...", "salesOrderId": "SO000042", "status": "To Ship and Invoice" },
  "old": { "id": "...", "salesOrderId": "SO000042", "status": "Draft" }
}
```

`old` appears only on updates. On a delete, `record` is the row as it last existed and there is no `old`. The only request header is `Content-Type: application/json`.

`eventId` identifies the individual change. It stays the same across retries of that change and differs between changes — including two separate edits to the same record — which makes it the field to de-duplicate on (see below).

## Configuration

Create and manage webhooks under **Settings → Webhooks**. A webhook has:

- **Name:** a label, unique within your company.
- **Table:** the one table to watch.
- **URL:** where the `POST` is sent; must be a valid URL.
- **Triggers:** any of insert, update, delete (at least one).
- **Active:** webhooks are on by default; switch off to pause delivery.

Carbon tracks a success and error count per webhook, with the timestamp of the last of each, so you can see at a glance whether your endpoint is healthy.

## Delivery & reliability

Webhooks are queued rather than sent inline with the database write, so a `POST` normally lands a few seconds after the change. A brief delay is expected; it is not a sign your endpoint was skipped.

Delivery is **at-least-once**. If your endpoint doesn't return a success status, Carbon retries the same change a few times with exponential backoff before giving up. Two consequences to design for:

- **Handle duplicates.** A delivery that times out or errors after you've already processed it will arrive again. De-duplicate on `eventId`, which is stable across retries of a change. Don't key on `type` + `record.id` — every update to a given record shares those, so you would discard genuine later changes.
- **A sustained outage still loses events.** Once retries are exhausted the change is dropped and counted as an error. Reconcile against the API when completeness matters.

The success and error counters record one outcome per change, not per attempt, so a retried-then-delivered event counts once as a success.

Carbon does **not** sign webhook payloads. There is no shared secret or signature header to verify against. Treat the webhook URL itself as the secret: serve it over HTTPS and include an unguessable token in the path or query so you can reject anything that doesn't carry it.

## Related

  - Integrations Prefer a packaged connector? See the first-party integrations.
  - Authentication Pull the full record from the API after a webhook tells you it changed.
