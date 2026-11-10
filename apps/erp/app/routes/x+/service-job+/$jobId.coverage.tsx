// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { serviceCoverages } from "~/modules/service/service.models";

/**
 * Changes the job's coverage: `post-service-job` moves the cost of the parts
 * already issued to the new coverage account.
 */
export async function action(args: ActionFunctionArgs) {
  const input = await validator(
    z.object({ coverage: z.enum(serviceCoverages) })
  ).request(args, { params: ["jobId"] });
  if ("invalid" in input) return input.invalid;
  const { api } = await authorize(args.request, { "service.jobs": "Edit" });
  return api.service.setServiceJobCoverage({
    serviceJobId: input.params.jobId,
    coverage: input.data.coverage
  });
}
