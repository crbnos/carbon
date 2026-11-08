// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { serviceJobFixedPriceValidator } from "~/modules/service/service.models";

/**
 * Completes the job: `post-service-job` reconciles its time cost (each entry
 * posted as it was logged) and sets it Completed. A fixed price from the
 * dialog is saved on the job first.
 */
export async function action(args: ActionFunctionArgs) {
  const input = await validator(serviceJobFixedPriceValidator).request(args, {
    params: ["jobId"]
  });
  if ("invalid" in input) return input.invalid;
  const { jobId } = input.params;
  const api = await carbon(args.request);

  if (input.data.fixedPrice !== undefined) {
    const saved = await api.service.updateServiceJob({
      ids: [jobId],
      field: "fixedPrice",
      value: String(input.data.fixedPrice)
    });
    if (saved.error) return saved;
  }

  return api.service.completeServiceJob({ serviceJobId: jobId });
}
