// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";

// `updates`: a JSON map of operation id to its new order.
const orderForm = z.object({ updates: z.string().min(1) });

export async function action(args: ActionFunctionArgs) {
  const input = await validator(orderForm).request(args, {
    params: ["jobId"]
  });
  if ("invalid" in input) return input.invalid;
  const orders = Object.fromEntries(
    Object.entries(JSON.parse(input.data.updates)).map(([id, order]) => [
      id,
      Number(order)
    ])
  );
  const api = await carbon(args.request);
  return api.production.reorderJobOperations({
    jobId: input.params.jobId,
    orders
  });
}
