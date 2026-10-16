// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { carbon, respond } from "~/modules/carbon.server";
import { path, requestReferrer } from "~/utils/path";

// The body is the configuration itself, as JSON; the operation validates it.
export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["jobId"] });
  if ("invalid" in input) return input.invalid;
  const { jobId } = input.params;
  const configuration = await args.request.json();
  const api = await carbon(args.request);
  const result = await api.production.job.configure({ jobId, configuration });
  return respond(args.request, result).redirect(
    requestReferrer(args.request) ?? path.to.job(jobId),
    { message: "Updated job" }
  );
}
