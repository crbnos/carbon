// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { releaseBatches } from "~/modules/production/production.server";
import { bulkStartFormResponse, fitsOneRequest } from "~/utils/table-jobs";
import {
  startAllMatchingBulkAction,
  startSelectedBulkAction
} from "~/utils/table-jobs.server";

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
    const { companyId, userId } = await requirePermissions(args.request, {
      update: "production"
    });
    const started = await startAllMatchingBulkAction(json.allMatching, {
      companyId,
      userId,
      actionKey: "batches.release",
      params: {}
    });
    if (started) return bulkStartFormResponse(started);
  }

  const input = await validator(selection).request(args);
  if ("invalid" in input) return input.invalid;
  if (!fitsOneRequest("batches.release", input.data.batchIds.length)) {
    const { companyId, userId } = await requirePermissions(args.request, {
      update: "production"
    });
    return bulkStartFormResponse(
      await startSelectedBulkAction({
        companyId,
        userId,
        actionKey: "batches.release",
        params: {},
        listKey: "operation-batches",
        ids: input.data.batchIds
      })
    );
  }
  const api = await carbon(args.request);
  return api.production.releaseBatches(input.data);
}
