# Audit log

> A per-company change history for key business entities. What gets recorded, how to view and filter it, and how old entries are archived.

The audit log records every create, update, and delete on Carbon's important business entities, along with who made the change and exactly which fields moved. It is a company-wide switch, **off by default**, and each company keeps its own log. Turn it on from **Settings → Audit Logs** and Carbon begins tracking changes to your data from that moment forward.

The audit log is entity-centric. A change to any underlying table that makes up an entity is attributed to the parent entity you recognize. Editing an item's cost, for example, records against the **Item**, not a raw `itemCost` row.

## Turning it on

Audit logging is a single toggle on the **Audit Logging** card. Enabling it creates the per-company log storage, sets `auditLogEnabled` on the company, and subscribes every auditable table to the change pipeline. The card reflects the state directly:

- Enabled: *"Audit logging is enabled — All changes to auditable entities are being recorded."*
- Disabled: *"Audit logging is disabled — Enable to start tracking changes to your data."*

Disabling it stops new records from being written, but **keeps everything already logged** — the existing history is preserved for compliance, not dropped. Re-enabling picks tracking back up; the gap while it was off simply isn't recorded.

Only users who can **update settings** can flip the toggle. Viewing the log needs the **view settings** permission. See `docs/reference/permissions` for how the settings module maps to employee types.

## What gets logged

Carbon tracks a fixed set of entities. Anything not on this list is not audited.

| Entity | Entity |
| --- | --- |
| Customer | Supplier |
| Item | Item Shelf Life |
| Sales Order | Purchase Order |
| Sales Invoice | Purchase Invoice |
| Quote | Supplier Quote |
| Job | Employee |
| Non-Conformance | Change Order |
| Gauge | Shipment |
| Receipt | Warehouse Transfer |
| Stock Transfer | Inventory Count |
| Work Center | Maintenance Schedule |
| Maintenance Dispatch | Pricing Rule |
| Price Override | Price Override Break |
| Fixed Asset | Accounting Period |

For each change, an entry captures the **operation** (`INSERT`, `UPDATE`, or `DELETE`), the **actor** (the user who made it — a system or service-role change shows as *System*), a **field-level diff** of what changed, request **metadata** (IP address, user agent, origin), and the **timestamp**. Fields that only reflect bookkeeping — `updatedAt`, `updatedBy`, and internal embeddings — are excluded from diffs, so the log stays focused on meaningful changes.

## Viewing and filtering

Two views surface the same data at different scopes.

**Per-entity history.** On most entity detail pages (a customer, sales order, job, shipment, and more) a **History** action opens a drawer showing just that record's timeline. Each change lists the operation, the actor, when it happened, and an expandable list of the fields that moved. If audit logging is off, the drawer says *"Audit logging is not enabled"* with a shortcut to enable it in settings (or a note to contact your administrator if you can't).

**The global log.** From the Audit Logs settings page, **View All** opens the full-screen **All Audit Logs** table. It is searchable and paginated, with filters for:

- **Entity** — narrow to one entity type (Sales Order, Item, and so on).
- **Operation** — Created, Updated, or Deleted.
- **Changed By** — the user (actor) responsible.

The table columns are **Entity**, **Operation**, **Changed By**, **Changes**, and **When**. Operations render as colored badges — Created (green), Updated (blue), Deleted (red) — and each row expands to show the field-level diff. The Entity value links straight to the record it describes.

## Retention and archives

The live log keeps the last **30 days** of activity. A nightly job sweeps entries older than that into a compressed archive, records the archive's date range, row count, and size, then removes the aged rows from the live table. Nothing is lost — it moves to cold storage.

Archived periods appear under **Archived Logs** on the settings page, each with a **Download** button that generates a short-lived signed link to the compressed export. When no archives exist yet, the card explains that logs older than 30 days will be archived and made available for download there.

Enabling audit logging affects data written from that point on. It does not retroactively reconstruct changes that happened before it was turned on.

## Related

  - Company settings The company record and its feature toggles, including audit logging.
  - Permissions and access How the settings permission gates who can view and manage the log.

## Troubleshooting

Audit logging is a paid feature (Business plan) and is off by default. Most "why can't I see the log" questions come down to the plan gate, the settings permission, or the feature never having been enabled.

### "Upgrade to Business to enable audit logging"
The audit log is gated to the Business plan on Carbon Cloud. The enable toggle is blocked until the company is on a qualifying plan. On self-hosted deployments the runtime plan gate does not apply, but the feature still follows the commercial-license boundary. Upgrade the plan (or, self-hosting, run under the appropriate license) then enable it in Settings → Audit Logs.

### "Upgrade to unlock audit history"
Shown on the per-entity History drawer when the company is not on a qualifying plan. Same cause and fix as above — the plan gate covers both the settings toggle and the in-context history drawer.

### "Audit logging is not enabled"
The History drawer opened but the company has audit logging turned off. Enable it in Settings → Audit Logs (needs the update-settings permission). If you can't, the drawer directs you to contact your administrator, who holds that permission.

### "Failed to enable audit logging" / "Failed to disable audit logging"
The toggle action hit a server error creating or removing the per-company log storage and its change subscriptions. Retry; if it persists the audit log table or event subscriptions may be in an inconsistent state and need a second toggle to re-sync.

### "Failed to generate download URL"
Requesting an archive download couldn't produce the signed link. The archive record may be missing its stored file, or the signed-URL request failed. Retry; the link is short-lived, so a stale one won't work.

### Empty history for a record you expected to see changes on
Preconditions: audit logging must have been **on** when the change happened (it does not backfill), and the record's entity must be one of the audited entities. Changes to non-audited entities, and any change made while the feature was off, are simply never recorded. Bookkeeping-only field updates (`updatedAt`, `updatedBy`, embeddings) are excluded from diffs, so a change that only touched those shows no field-level changes.

### An older change is missing from the live log
The live log retains only the last 30 days. Older entries move to the **Archived Logs** section as a downloadable compressed export — look there rather than in the live table.
