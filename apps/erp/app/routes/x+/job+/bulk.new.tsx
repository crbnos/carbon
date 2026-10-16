// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { bulkJobValidator } from "~/modules/production/production.models";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(bulkJobValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.production.createJobs({
    ...input.data,
    customFields: setCustomFields(input.formData ?? new FormData())
  });
  return respond(args.request, result).redirect(path.to.jobs, {
    message: `Successfully created ${result.data?.jobIds.length} jobs`,
    onError: path.to.newJob
  });
}
