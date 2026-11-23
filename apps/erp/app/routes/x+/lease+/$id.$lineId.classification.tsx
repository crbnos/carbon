// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { leaseClassificationValidator } from "~/modules/purchasing/purchasing.models";
import { path, requestReferrer } from "~/utils/path";

// Override one leased asset's classification, or `intent=remove` to clear
// the override so the five tests decide again.
const form = z.union([
  z.object({ intent: z.literal("remove") }),
  leaseClassificationValidator
]);

export async function action(args: ActionFunctionArgs) {
  const input = await validator(form).request(args, {
    params: ["id", "lineId"]
  });
  if ("invalid" in input) return input.invalid;
  const { id: leaseId, lineId: leaseLineId } = input.params;
  const to =
    requestReferrer(args.request) ?? path.to.leaseSetup(leaseId, "accounting");
  const api = await carbon(args.request);

  if ("intent" in input.data) {
    const result = await api.purchasing.removeLeaseLineClassificationOverride({
      leaseId,
      leaseLineId
    });
    return respond(args.request, result).redirect(to, {
      message: "Classification override removed"
    });
  }
  const result = await api.purchasing.overrideLeaseLineClassification({
    ...input.data,
    leaseId,
    leaseLineId
  });
  return respond(args.request, result).redirect(to, {
    message: `Classified as ${input.data.classification}`
  });
}
