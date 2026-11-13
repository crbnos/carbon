// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { serviceJobStatusActions } from "~/modules/service/service.models";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(
    z.object({ action: z.enum(serviceJobStatusActions) })
  ).request(args, { params: ["jobId"] });
  if ("invalid" in input) return input.invalid;
  const { api } = await authorize(args.request, { "service.jobs": "Edit" });
  return api.service.setServiceJobStatus({
    jobId: input.params.jobId,
    action: input.data.action
  });
}
