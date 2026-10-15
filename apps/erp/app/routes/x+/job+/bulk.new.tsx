// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { carbon, redirectWithResult } from "~/modules/carbon.server";
import { bulkJobValidator } from "~/modules/production";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(bulkJobValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.production.job.createMany({
    ...input.data,
    customFields: setCustomFields(input.formData ?? new FormData())
  });
  return redirectWithResult(args.request, result, {
    to: result.error ? path.to.newJob : path.to.jobs,
    message: `Successfully created ${result.data?.jobIds.length} jobs`
  });
}
