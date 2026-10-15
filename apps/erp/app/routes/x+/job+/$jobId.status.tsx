// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { carbon, redirectWithResult } from "~/modules/carbon.server";
import { path } from "~/utils/path";

// The job header's status buttons. Release, Complete and Cancel have their own
// routes; Cancelled stays here for older callers.
const statusForm = z.object({
  status: z.enum([
    "Planned",
    "Paused",
    "Ready",
    "Draft",
    "In Progress",
    "Closed",
    "Cancelled"
  ])
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(statusForm).request(args, {
    params: ["jobId"]
  });
  if ("invalid" in input) return input.invalid;
  const { jobId } = input.params;
  const api = await carbon(args.request);

  switch (input.data.status) {
    case "Planned": {
      const result = await api.production.job.plan({ jobId });
      if (result.error) return result;
      return redirectWithResult(args.request, result, {
        to: path.to.jobMaterials(jobId),
        message: "Job marked as planned"
      });
    }
    case "Paused":
      return api.production.job.pause({ jobId });
    case "Ready":
      return api.production.job.resume({ jobId });
    case "Draft":
    case "In Progress":
      return api.production.job.reopen({ jobId });
    case "Closed":
      return api.production.job.close({ jobId });
    case "Cancelled":
      return api.production.job.cancel({ jobId });
  }
}
