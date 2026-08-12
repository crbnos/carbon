import { t } from "../definition/types";
import type { MomentDeclarationLike } from "./build";

// Business events a row change cannot express. Every declaration must have a
// raiseMoment site, or `scripts/check-workflow-catalog.ts` fails the build.
export const WORKFLOW_MOMENTS = {
  "production.jobReleased": {
    label: "A job is released",
    permission: "production",
    outputs: { job: t.entity("job"), releasedBy: t.entity("user") }
  },
  "production.jobHeld": {
    label: "A job is put on hold",
    permission: "production",
    outputs: { job: t.entity("job"), heldBy: t.entity("user") }
  },
  "production.jobOperationCompleted": {
    label: "A job operation is completed",
    permission: "production",
    outputs: {
      job: t.entity("job"),
      jobOperation: t.entity("jobOperation"),
      completedBy: t.entity("user")
    }
  },
  "sales.quoteSent": {
    label: "A quote is sent",
    permission: "sales",
    outputs: { quote: t.entity("quote"), sentBy: t.entity("user") }
  },
  "sales.quoteAccepted": {
    label: "A quote is accepted",
    permission: "sales",
    outputs: { quote: t.entity("quote"), salesOrder: t.entity("salesOrder") }
  },
  "inventory.receiptPosted": {
    label: "A receipt is posted",
    permission: "inventory",
    outputs: { receipt: t.entity("receipt"), postedBy: t.entity("user") }
  },
  "inventory.shipmentPosted": {
    label: "A shipment is posted",
    permission: "inventory",
    outputs: { shipment: t.entity("shipment"), postedBy: t.entity("user") }
  },
  "invoicing.salesInvoicePosted": {
    label: "A sales invoice is posted",
    permission: "invoicing",
    outputs: {
      salesInvoice: t.entity("salesInvoice"),
      postedBy: t.entity("user")
    }
  },
  "invoicing.purchaseInvoicePosted": {
    label: "A purchase invoice is posted",
    permission: "invoicing",
    outputs: {
      purchaseInvoice: t.entity("purchaseInvoice"),
      postedBy: t.entity("user")
    }
  }
} as const satisfies Record<string, MomentDeclarationLike>;

export type MomentKey = keyof typeof WORKFLOW_MOMENTS;

/** Entity outputs are passed as an id, never a row snapshot. */
export type MomentEntityRef = { id: string };

export type MomentPayload<K extends MomentKey> = {
  [O in keyof (typeof WORKFLOW_MOMENTS)[K]["outputs"]]: MomentEntityRef;
};
