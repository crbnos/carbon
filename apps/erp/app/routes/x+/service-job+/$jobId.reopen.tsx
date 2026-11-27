// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";

/** Reopens a Completed job: `post-service-job` reverses its time journal. */
export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["jobId"] });
  if ("invalid" in input) return input.invalid;
  const { api } = await authorize(args.request, { "service.jobs": "Edit" });
  return api.service.reopenServiceJob({ serviceJobId: input.params.jobId });
}
