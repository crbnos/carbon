// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { path } from "~/utils/path";

/**
 * Removes a part or a charge. A part goes back to stock through the `issue`
 * posting; a charge is deleted.
 */
export async function action(args: ActionFunctionArgs) {
  const input = await validator(
    z.object({ lineType: z.enum(["Part", "Charge"]) })
  ).request(args, { params: ["jobId", "itemId"] });
  if ("invalid" in input) return input.invalid;
  const { jobId, itemId } = input.params;
  const api = await carbon(args.request);
  const isPart = input.data.lineType === "Part";
  const result = isPart
    ? await api.service.unissueServiceJobPart({
        serviceJobId: jobId,
        id: itemId
      })
    : await api.service.deleteServiceJobCharge({
        serviceJobId: jobId,
        id: itemId
      });
  return respond(args.request, result).redirect(path.to.serviceJob(jobId), {
    message: isPart ? "Part returned to inventory" : "Charge removed"
  });
}
