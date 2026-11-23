// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { releaseBatches } from "~/modules/production/production.server";
import { startBackgroundBulkAction } from "~/utils/table-jobs.server";

// The batches table's bulk Release: no dialog, so a batch with a purchase
// order choice to make is refused and named.
// `{ allMatching: { listKey, search } }` in place of `batchIds` releases every
// matching batch in the background job instead, up to 2,000 batches. More
// than 10 selected batches also go to the background job: each releases its
// member jobs with MRP, and one request must end before the 600 s cutoff.
const selection = releaseBatches.input.pick({ batchIds: true });

export async function action(args: ActionFunctionArgs) {
  const json = await args.request
    .clone()
    .json()
    .catch(() => null);
  if (json?.allMatching) {
    const started = await startBackgroundBulkAction(
      args.request,
      "batches.release",
      { allMatching: json.allMatching },
      {}
    );
    if (started) return started;
  }

  const input = await validator(selection).request(args);
  if ("invalid" in input) return input.invalid;
  const started = await startBackgroundBulkAction(
    args.request,
    "batches.release",
    { ids: input.data.batchIds },
    {}
  );
  if (started) return started;
  const api = await carbon(args.request);
  return api.production.releaseBatches(input.data);
}
