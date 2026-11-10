// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";

const line = {
  receiptId: z.string().min(1),
  receiptLineId: z.string().min(1)
};

// One form per tracking type. `returnEntity` assigns (or with
// `intent=remove` clears) an entity a customer sent back.
const tracking = z.discriminatedUnion("trackingType", [
  z.object({
    trackingType: z.literal("batch"),
    ...line,
    batchNumber: z.string(),
    quantity: zfd.numeric(z.number()),
    // A JSON object; one that does not parse saves no properties.
    properties: zfd.text(z.string().optional()).transform((json) => {
      try {
        return json ? (JSON.parse(json) as Record<string, unknown>) : {};
      } catch {
        return {};
      }
    }),
    trackedEntityId: zfd.text(z.string().optional())
  }),
  z.object({
    trackingType: z.literal("serial"),
    ...line,
    serialNumber: z.string(),
    index: zfd.numeric(z.number()),
    expiryDate: zfd.text(z.string().optional())
  }),
  z.object({
    trackingType: z.literal("returnEntity"),
    ...line,
    intent: z.enum(["assign", "remove"]).default("assign"),
    trackedEntityId: z.string().min(1),
    index: zfd.numeric(z.number().optional())
  })
]);

export async function action(args: ActionFunctionArgs) {
  const input = await validator(tracking).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const { data } = input;
  switch (data.trackingType) {
    case "batch":
      return api.inventory.setReceiptLineBatch(data);
    case "serial":
      return api.inventory.setReceiptLineSerial(data);
    case "returnEntity":
      return data.intent === "remove"
        ? api.inventory.removeReceiptReturnEntity(data)
        : api.inventory.assignReceiptReturnEntity(data);
  }
}
