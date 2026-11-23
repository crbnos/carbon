// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(
    z.object({ supplierId: zfd.text(z.string().optional()) })
  ).request(args, { params: ["id"] });
  if ("invalid" in input) return input.invalid;
  const { id } = input.params;
  const api = await carbon(args.request);
  const result = await api.quality.draftIssueSupplierReturn({
    nonConformanceId: id,
    supplierId: input.data.supplierId
  });
  if (result.error) {
    return respond(args.request, result).redirect(path.to.issue(id));
  }
  const { created, purchaseReturnOrderId } = result.data;
  return respond(args.request, result).redirect(
    purchaseReturnOrderId
      ? path.to.purchaseReturnOrder(purchaseReturnOrderId)
      : path.to.issue(id),
    {
      message: created
        ? "Supplier return drafted"
        : "Every Return to Supplier quantity is already covered by a linked return"
    }
  );
}
