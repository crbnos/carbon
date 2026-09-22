/**
 * The CE-safe wire contract for workflow "moments" — business events a row
 * change cannot express. `@carbon/lib` (`raise-moment.ts`) needs `MomentKey` /
 * `MomentPayload` type-only, and importing them from the full workflow engine
 * (now `@carbon/ee/workflows`) would create a `lib → ee → lib` package cycle.
 *
 * The FULL declarations (labels, permissions, `t.entity(...)` output types) stay
 * the engine's source of truth in `catalog/moments.ts` (`WORKFLOW_MOMENTS`). This
 * leaf carries ONLY each moment's output KEY NAMES — all `MomentPayload<K>`
 * derives from — so it stays zod/dep-free. `scripts/check-workflow-catalog.ts`
 * asserts the two never drift (same keys, same output-key names).
 */
export const MOMENT_OUTPUT_KEYS = {
  "production.jobReleased": ["job", "releasedBy"],
  "production.jobHeld": ["job", "heldBy"],
  "production.jobOperationCompleted": ["job", "jobOperation", "completedBy"],
  "sales.quoteSent": ["quote", "sentBy"],
  "sales.quoteAccepted": ["quote", "salesOrder"],
  "inventory.receiptPosted": ["receipt", "postedBy"],
  "inventory.shipmentPosted": ["shipment", "postedBy"],
  "invoicing.salesInvoicePosted": ["salesInvoice", "postedBy"],
  "invoicing.purchaseInvoicePosted": ["purchaseInvoice", "postedBy"]
} as const;

export type MomentKey = keyof typeof MOMENT_OUTPUT_KEYS;

/** Entity outputs are passed as an id, never a row snapshot. */
export type MomentEntityRef = { id: string };

export type MomentPayload<K extends MomentKey> = {
  [O in (typeof MOMENT_OUTPUT_KEYS)[K][number]]: MomentEntityRef;
};
