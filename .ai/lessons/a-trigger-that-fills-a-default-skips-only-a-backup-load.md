---
paths: []
triggers: ["app.sync_in_progress", "app.dataset_apply", "app.backup_load"]
promoted: null
---
# A trigger that fills a default skips only a backup load

**Context:** The part number display triggers (`20261121061455_supplier-part-number-display.sql` and the customer migration after it) first skipped when `app.sync_in_progress` was set, so the dataset apply could stamp the seeded lines itself. Then they skipped `app.dataset_apply`, and a TypeScript helper stamped the seeded lines after the tiers.

**Problem:** `app.sync_in_progress` is also the accounting sync's flag (`withTriggersDisabled`, `@carbon/ee/accounting`). The Xero purchase order pull deletes and re-inserts every line under it, so every synced line came back with no display choice and no copy of the supplier part number. The `app.dataset_apply` skip needed a second copy of the trigger's rule in TypeScript, and that helper's company-wide UPDATE stamped a real company's legacy lines on a dev seed without a wipe.

**Rule:** A trigger that fills a default for a new row skips only `app.backup_load`: a restore brings its own values. Let it run during a dataset apply: the tiers insert parents before children, so it gives seeded rows the values it gives any row. Use `app.sync_in_progress` only to skip side effects an external sync must not cause (events, webhooks, contact cleanup).

**Applies to:** Every new BEFORE/AFTER row trigger or interceptor that fills or derives a value on insert.
