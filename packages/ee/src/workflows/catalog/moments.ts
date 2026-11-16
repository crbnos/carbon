// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { t } from "../definition/types";
import type { MomentDeclarationLike } from "./build";

// Business events a row change cannot express. Every declaration must have a
// raiseMoment site, or `scripts/check-workflow-catalog.ts` fails the build.
export const WORKFLOW_MOMENTS = {
  "production.jobReleased": {
    label: "A job is released",
    table: "job",
    outputs: { job: t.entity("job"), releasedBy: t.entity("user") }
  },
  "production.jobHeld": {
    label: "A job is put on hold",
    table: "job",
    outputs: { job: t.entity("job"), heldBy: t.entity("user") }
  },
  "production.jobOperationCompleted": {
    label: "A job operation is completed",
    table: "jobOperation",
    outputs: {
      job: t.entity("job"),
      jobOperation: t.entity("jobOperation"),
      completedBy: t.entity("user")
    }
  },
  "sales.quoteSent": {
    label: "A quote is sent",
    table: "quote",
    outputs: { quote: t.entity("quote"), sentBy: t.entity("user") }
  },
  "sales.quoteAccepted": {
    label: "A quote is accepted",
    table: "quote",
    outputs: { quote: t.entity("quote"), salesOrder: t.entity("salesOrder") }
  },
  "inventory.receiptPosted": {
    label: "A receipt is posted",
    table: "receipt",
    outputs: { receipt: t.entity("receipt"), postedBy: t.entity("user") }
  },
  "inventory.shipmentPosted": {
    label: "A shipment is posted",
    table: "shipment",
    outputs: { shipment: t.entity("shipment"), postedBy: t.entity("user") }
  },
  "invoicing.salesInvoicePosted": {
    label: "A sales invoice is posted",
    table: "salesInvoice",
    outputs: {
      salesInvoice: t.entity("salesInvoice"),
      postedBy: t.entity("user")
    }
  },
  "invoicing.purchaseInvoicePosted": {
    label: "A purchase invoice is posted",
    table: "purchaseInvoice",
    outputs: {
      purchaseInvoice: t.entity("purchaseInvoice"),
      postedBy: t.entity("user")
    }
  }
} as const satisfies Record<string, MomentDeclarationLike>;

// `MomentKey` / `MomentEntityRef` / `MomentPayload` are the CE-safe moment
// contract, defined in `@carbon/workflows-core` (so `@carbon/lib` can use them
// without a cycle into this commercial engine) and derived there from
// `MOMENT_OUTPUT_KEYS`. `WORKFLOW_MOMENTS` above stays the source of truth for the
// labels/permissions/entity types; `scripts/check-workflow-catalog.ts` asserts the
// two never drift (same keys, same output-key names).
export type {
  MomentEntityRef,
  MomentKey,
  MomentPayload
} from "@carbon/workflows-core";
