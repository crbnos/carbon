// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { createJobOperationBatchValidator } from "~/modules/production/production.models";

// The Release dialog's per-supplier PO choice ("new" or a Draft PO id), posted
// as JSON. Absent when nothing needed choosing.
const purchaseOrderChoice = z.preprocess((value) => {
  if (typeof value !== "string" || !value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}, z.record(z.string(), z.string()).optional());

const batchId = z.string().min(1);

// The batch builder, the batch drawer, the batches table and the schedule
// board: one operation per intent.
const batchingForm = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("reprioritize"),
    batchId,
    priority: zfd.numeric(
      z.number().refine(Number.isFinite, "Priority must be finite")
    )
  }),
  z.object({ intent: z.literal("mergeOutputs"), batchId, itemId: z.string() }),
  createJobOperationBatchValidator.extend({
    intent: z.literal("create"),
    purchaseOrdersBySupplierId: purchaseOrderChoice
  }),
  z.object({
    intent: z.enum(["release", "unrelease"]),
    batchId,
    purchaseOrdersBySupplierId: purchaseOrderChoice
  }),
  z.object({
    intent: z.enum(["add", "remove", "update", "dissolve"]),
    batchId,
    jobOperationIds: zfd.repeatableOfType(z.string().min(1)).optional(),
    workCenterId: zfd.text(z.string().optional())
  })
]);

export async function action(args: ActionFunctionArgs) {
  const input = await validator(batchingForm).request(args);
  if ("invalid" in input) return input.invalid;
  const form = input.data;
  const batch = (await carbon(args.request)).production;

  switch (form.intent) {
    case "reprioritize":
      return batch.reprioritizeBatch(form);
    case "mergeOutputs":
      return batch.mergeBatchOutputs(form);
    case "create": {
      const { intent: _intent, ...create } = form;
      return batch.createBatch(create);
    }
    case "release":
      return batch.releaseBatches({
        batchIds: [form.batchId],
        purchaseOrdersBySupplierId: form.purchaseOrdersBySupplierId
      });
    case "unrelease":
      return batch.unreleaseBatch({ batchId: form.batchId });
    default: {
      const { intent: type, ...update } = form;
      return batch.updateBatch({ ...update, type });
    }
  }
}
