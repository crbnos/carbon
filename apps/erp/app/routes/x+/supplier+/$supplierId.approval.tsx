// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { approvalDecisionValidator } from "@carbon/ee/approvals";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { path } from "~/utils/path";

// The supplier header posts an intent, or the approval dialog's decision.
const form = z.union([
  z.object({ intent: z.enum(["request-approval", "make-inactive"]) }),
  approvalDecisionValidator
]);

export async function action(args: ActionFunctionArgs) {
  const input = await validator(form).request(args, {
    params: ["supplierId"]
  });
  if ("invalid" in input) return input.invalid;
  const { supplierId } = input.params;
  const to = path.to.supplier(supplierId);
  const api = await carbon(args.request);

  if ("intent" in input.data) {
    if (input.data.intent === "request-approval") {
      const result = await api.purchasing.requestSupplierApproval({
        supplierId
      });
      return respond(args.request, result).redirect(to, {
        message: "Approval request submitted"
      });
    }
    const result = await api.purchasing.deactivateSupplier({ supplierId });
    return respond(args.request, result).redirect(to, {
      message: "Supplier deactivated"
    });
  }

  const result = await api.purchasing.decideSupplierApproval({
    ...input.data,
    supplierId
  });
  return respond(args.request, result).redirect(to, {
    message: `Approval request ${input.data.decision.toLowerCase()} successfully`
  });
}
