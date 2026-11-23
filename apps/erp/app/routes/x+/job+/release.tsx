// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { releaseJobs } from "~/modules/production/production.server";
import { startBackgroundBulkAction } from "~/utils/table-jobs.server";

// The jobs table's Release Jobs: no dialog, so a job with a choice to make is
// refused and named rather than released with a guess.
// `{ allMatching: { listKey, search } }` in place of `jobIds` releases every
// matching job in the background job instead, up to 2,000 jobs. More than 25
// selected jobs also go to the background job: each runs MRP, and one request
// must end before the load balancer's 600 s.
const selection = releaseJobs.input.pick({ jobIds: true });

export async function action(args: ActionFunctionArgs) {
  const json = await args.request
    .clone()
    .json()
    .catch(() => null);
  if (json?.allMatching) {
    const started = await startBackgroundBulkAction(
      args.request,
      "jobs.release",
      { allMatching: json.allMatching },
      {}
    );
    if (started) return started;
  }

  const input = await validator(selection).request(args);
  if ("invalid" in input) return input.invalid;
  const started = await startBackgroundBulkAction(
    args.request,
    "jobs.release",
    { ids: input.data.jobIds },
    {}
  );
  if (started) return started;
  const api = await carbon(args.request);
  return api.production.releaseJobs(input.data);
}
