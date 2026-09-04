# Carbon agent, stock movement corrections, and notification preferences

> An AI agent inside Carbon, corrections for any posted stock movement, per-topic notification preferences, and per-item serial number sequences.

The Carbon agent answers questions and takes actions inside the app. Any posted stock movement can be corrected with a linked correction row, replacing count rectification. Notification preferences are per user and per topic, with email and Slack opt-outs. Serial number sequences are configurable per item.

## Change notices and assembly instructions

Change notices gained an implementation lock with reopen and links to Linear tasks; assembly instructions are versioned and surfaced in change notice diffs.

- MES: material picking with opt-in pre-select and an incomplete-pick policy, a Load Preview on the job-operation model tab, and NCR containment inspection steps created as needed in the assembly view.
- Shop-floor assembly and inspection execution.
- An opt-in materials section on the job traveler PDF, and total rows on the Estimates vs Actual card.
- CSV bulk import for material properties, and the combined parts-with-methods import is back.
- Released drawings and CAD models upload from Onshape.
- Line-item shipping cost on the purchase order PDF, with corrected document totals.
- Quick-filter toggles on inventory count lines.
- Audit logs show related records and mark empty values.
- Backups are available to non-internal users on self-hosted installs.
- The accounting module is internationalized.
- Academy: redesigned, with a Work Instructions and Process Types lesson.

- Jobs cannot be created with zero quantity, and a job can re-link to a sales order line.
- Receipts: posting is blocked on voided receipts and the Pending transition is atomic.
- Bin-to-bin batch transfers no longer consume the lot; the transfer wizard was redesigned.
- Invoice due dates recompute when the issue date or payment term changes.
- MES: fractional quantities in the operation quantity modal, expired lots excluded from FEFO suggestions, picked remainders return to the actual pick bin, and work instructions render step images.
- Passkey sign-in fails safely on a company lookup error and shows the company picker for multi-company users.
- Digital quote lines can be deselected and removed wherever they are selectable.
- Line tax percent shows two decimals; the job traveler BOM header stays attached across page breaks.
- Notification recipients who left the company are dropped.
- Onshape OAuth failures are surfaced on the integrations page.
