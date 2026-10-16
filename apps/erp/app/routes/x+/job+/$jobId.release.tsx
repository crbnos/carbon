// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { releaseJobs } from "~/modules/production/production.server";

// The Release dialog: its purchase order and supplier choices, as JSON.
const releaseChoices = releaseJobs.input.omit({ jobIds: true });

export async function action(args: ActionFunctionArgs) {
  const input = await validator(releaseChoices).request(args, {
    params: ["jobId"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.production.releaseJobs({
    jobIds: [input.params.jobId],
    ...input.data
  });
}
