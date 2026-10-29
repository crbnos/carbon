// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs } from "react-router";
import { jobCompleteValidator } from "~/modules/production/production.models";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Jobs`,
  to: path.to.jobs,
  module: "production"
};

export async function action(args: ActionFunctionArgs) {
  const input = await validator(jobCompleteValidator).request(args, {
    params: ["jobId"]
  });
  if ("invalid" in input) return input.invalid;
  const { quantityComplete, locationId, storageUnitId } = input.data;
  const api = await carbon(args.request);
  return api.production.completeJob({
    jobId: input.params.jobId,
    quantityComplete,
    locationId,
    storageUnitId
  });
}
