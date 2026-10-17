// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { jobMaterialValidator } from "~/modules/production/production.models";
import { setCustomFields } from "~/utils/form";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(jobMaterialValidator).request(args, {
    params: ["jobId", "id"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.production.updateJobMaterial({
    ...input.data,
    id: input.params.id,
    jobId: input.params.jobId,
    customFields: setCustomFields(input.formData ?? new FormData())
  });
}
