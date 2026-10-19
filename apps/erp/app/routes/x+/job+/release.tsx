// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { releaseJobs } from "~/modules/production/production.server";

// The jobs table's Release Jobs: no dialog, so a job with a choice to make is
// refused and named rather than released with a guess.
const selection = releaseJobs.input.pick({ jobIds: true });

export async function action(args: ActionFunctionArgs) {
  const input = await validator(selection).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.production.releaseJobs(input.data);
}
