/**
 * The work-done event catalog.
 *
 * "Work done" means a record was created, a state changed in a way that means
 * work happened, a quantity was recorded against reality, or something was sent
 * outward. Opening a screen is not work; neither is searching, filtering, or a
 * write that happens as a side effect of viewing a page.
 *
 * Every event here answers a question a plant manager or an operator would ask
 * by name. The full catalog these are drawn from, including the deferred waves
 * and the reasoning per event, lives in `adoption-tracking/work-done-events.md`
 * alongside this repo.
 *
 * ## What may go in a payload
 *
 * Ids, enum values, counts, and physical quantities. Nothing else.
 *
 * Deliberately excluded: monetary amounts, part numbers, item descriptions,
 * customer and supplier names, free text of any kind. Adoption is measured in
 * counts and elapsed time, so values add sensitivity without adding signal —
 * and Carbon sells to defense and aerospace accounts whose part numbers and
 * order values are the sensitive part. An id is resolvable against the
 * customer's own database when someone genuinely needs the detail.
 *
 * @see ./capture.ts for how these reach PostHog.
 */

/** The Carbon module a piece of work belongs to. Used to group adoption by area. */
export type WorkModule =
  | "production"
  | "inventory"
  | "sales"
  | "purchasing"
  | "invoicing";

/**
 * Which surface the work was entered from.
 *
 * This is the single most useful property in the catalog: it separates a shop
 * floor genuinely using the MES from a clerk typing yesterday's paper traveller
 * into the back office. Nothing else distinguishes those two, and they mean
 * completely different things about adoption.
 */
export type WorkSource = "erp" | "mes" | "mes_qr" | "api" | "portal";

/**
 * Where a job came from.
 *
 * A separate axis from `WorkSource`: every creation path funnels through one
 * service function and the `job` row itself cannot tell them apart, so the
 * caller has to say. The distinction is the difference between a shop planning
 * its work and a shop reacting to one.
 */
export const JOB_SOURCES = [
  "erp",
  "bulk",
  "mrp",
  "salesOrder",
  "kanban",
  "api",
  "workflow",
  /**
   * The caller did not say. Reaching `insertJob` without a source is normal —
   * the MCP tool and the workflow engine both dispatch `production_insertJob`
   * by name through a generic (call, context, inputs) signature that has
   * nowhere to put one. Defaulting those to `erp` would report automation as
   * human work, which is the single thing this field exists to separate.
   */
  "unknown"
] as const;

export type JobSource = (typeof JOB_SOURCES)[number];

/**
 * Narrow an untrusted value to a `JobSource`, falling back to `unknown`.
 *
 * `insertJob` is reachable as an MCP tool, and the generated tool schema types
 * this parameter as `{}` — the generator resolves inline unions but not an
 * imported alias — so nothing between a caller and the event enforces the set.
 * TypeScript is not a runtime guard here: without this, an agent passing
 * `source: "banana"` would put "banana" in the analytics enum permanently.
 */
export function asJobSource(value: unknown): JobSource {
  return JOB_SOURCES.includes(value as JobSource)
    ? (value as JobSource)
    : "unknown";
}

type Base = {
  companyId: string;
  /** Carbon `userId` of the actor. Null for service-role and customer-portal work. */
  userId: string | null;
};

/**
 * Every work event, with the properties it carries.
 *
 * Adding an entry here is the whole change on the emit side — `captureWorkEvent`
 * is typed off this map, so a name that is not in it will not compile, and a
 * payload missing a property will not either.
 */
export type WorkEvents = {
  // ------------------------------------------------------------- production
  job_created: Base & {
    jobId: string;
    itemId: string;
    quantity: number;
    scrapQuantity: number;
    locationId: string | null;
    /** Set when the job was raised to serve a specific sales order line. */
    salesOrderLineId: string | null;
    deadlineType: string | null;
    source: JobSource;
  };
  job_released: Base & {
    jobId: string;
    /** What the job was before. A re-save of an already-Ready job never emits. */
    priorStatus: string;
    /** `kanban` when a scan released it, so auto-releases stay separable. */
    source: JobSource;
  };
  job_operation_started: Base & {
    /**
     * The `productionEvent` row. An operator clocks on and off a step many
     * times, so the operation id would collapse a shift into one event — this
     * is what makes each clock-on its own occurrence.
     */
    productionEventId: string;
    jobOperationId: string;
    /** Setup, Labor or Machine. */
    eventType: string;
    source: WorkSource;
  };
  production_quantity_reported: Base & {
    /** The `productionQuantity` row — one posting, not one operation. */
    productionQuantityId: string;
    jobOperationId: string;
    quantity: number;
    /**
     * Which surface posted it. The ratio of `mes`/`mes_qr` to `erp` is the best
     * single measure of whether the shop floor app is genuinely in use or a
     * clerk is typing yesterday's paper traveller into the back office.
     */
    source: WorkSource;
  };
  job_operation_finished: Base & {
    jobOperationId: string;
    jobId: string;
  };
  job_completed: Base & {
    jobId: string;
    /** `manual` from the complete route; `auto` when the last operation closed it. */
    path: "manual" | "auto";
  };
  scrap_reported: Base & {
    /** The `productionQuantity` row carrying type 'Scrap'. */
    productionQuantityId: string;
    jobOperationId: string;
    quantity: number;
    scrapReasonId: string | null;
    source: WorkSource;
  };

  // -------------------------------------------------------------- inventory
  receipt_posted: Base & {
    receiptId: string;
    /** Purchase Order, Inbound Transfer, and so on. */
    sourceDocument: string | null;
  };
  shipment_posted: Base & {
    shipmentId: string;
    /** Sales Order, Purchase Order (outside processing), Outbound Transfer. */
    sourceDocument: string | null;
  };
  picking_list_completed: Base & {
    pickingListId: string;
    /** Completed, Partial or Cancelled. */
    finalStatus: string;
    /** `mes` when the floor closed it, `erp` when the office did. */
    source: WorkSource;
  };

  // ------------------------------------------------------------------ sales
  quote_sent: Base & {
    quoteId: string;
  };
  quote_accepted: Base & {
    quoteId: string;
    salesOrderId: string;
    /** `portal` means the customer accepted it themselves, with no Carbon user. */
    acceptedBy: "internal" | "portal";
  };
  sales_order_confirmed: Base & {
    salesOrderId: string;
    lineCount: number;
    /** The status the line mix derived — To Ship and Invoice, and so on. */
    derivedStatus: string;
    emailed: boolean;
  };

  // ------------------------------------------------------------- purchasing
  purchase_order_finalized: Base & {
    purchaseOrderId: string;
    /**
     * Where the order got to, and the discriminator — one `gated` and one
     * `committed` event per order, never two of either.
     *
     * `gated`: the finalize stopped at an approval threshold. Nothing is owed
     * to the supplier yet, so this must never be counted as spend.
     * `committed`: the order is live. Reached either directly, when no
     * threshold applied, or later from `approveRequest` when an approver
     * released a gated one — a different module, which is why a single emit on
     * the finalize route left approved orders uncounted entirely.
     *
     * "POs issued this week" is `stage = committed`.
     */
    stage: "gated" | "committed";
  };

  // --------------------------------------------------------------- invoicing
  sales_invoice_posted: Base & {
    salesInvoiceId: string;
  };
  purchase_invoice_posted: Base & {
    purchaseInvoiceId: string;
  };
};

export type WorkEventName = keyof WorkEvents;

/** Which module each event belongs to, for grouping adoption by area. */
export const WORK_EVENT_MODULE: Record<WorkEventName, WorkModule> = {
  job_created: "production",
  job_released: "production",
  job_operation_started: "production",
  production_quantity_reported: "production",
  job_operation_finished: "production",
  job_completed: "production",
  scrap_reported: "production",
  receipt_posted: "inventory",
  shipment_posted: "inventory",
  picking_list_completed: "inventory",
  quote_sent: "sales",
  quote_accepted: "sales",
  sales_order_confirmed: "sales",
  purchase_order_finalized: "purchasing",
  sales_invoice_posted: "invoicing",
  purchase_invoice_posted: "invoicing"
};

export const WORK_EVENT_NAMES = Object.keys(
  WORK_EVENT_MODULE
) as WorkEventName[];

/** The payload keys of one event that hold a string id. */
type IdKeyOf<E extends WorkEventName> = {
  [K in keyof WorkEvents[E]]: WorkEvents[E][K] extends string ? K : never;
}[keyof WorkEvents[E]];

/**
 * The record whose id makes an occurrence unique, per event.
 *
 * Used to build the idempotency key, so a retry collapses instead of counting
 * twice. Where an event can legitimately recur against one record — a second
 * production quantity on the same operation — the emit site supplies a
 * discriminator as well.
 */
export const WORK_EVENT_RECORD_KEY: {
  [E in WorkEventName]: IdKeyOf<E>;
} = {
  job_created: "jobId",
  job_released: "jobId",
  job_operation_started: "productionEventId",
  production_quantity_reported: "productionQuantityId",
  job_operation_finished: "jobOperationId",
  job_completed: "jobId",
  scrap_reported: "productionQuantityId",
  receipt_posted: "receiptId",
  shipment_posted: "shipmentId",
  picking_list_completed: "pickingListId",
  quote_sent: "quoteId",
  quote_accepted: "quoteId",
  sales_order_confirmed: "salesOrderId",
  purchase_order_finalized: "purchaseOrderId",
  sales_invoice_posted: "salesInvoiceId",
  purchase_invoice_posted: "purchaseInvoiceId"
};
