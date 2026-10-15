// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { carbon } from "~/modules/carbon.server";
import { getJobMethodValidator } from "~/modules/production";
import { path, requestReferrer } from "~/utils/path";

// Get Method: onto the job from an item, quote line or job, or onto a made
// sub-assembly's method ("method") from an item.
const getMethodForm = getJobMethodValidator.extend({
  type: z.enum(["item", "quoteLine", "job", "method"]),
  configuration: z.string().optional()
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(getMethodForm).request(args);
  if ("invalid" in input) return input.invalid;
  const { type, configuration, sourceId, targetId, versionId, ...parts } =
    input.data;
  const method = {
    sourceId,
    targetId,
    versionId,
    parts,
    configuration: configuration ? JSON.parse(configuration) : undefined
  };
  const api = await carbon(args.request);

  if (type !== "method") {
    return api.production.method.copyToJob({ ...method, type });
  }
  const result = await api.production.method.copyToMaterial(method);
  if (result.error) return result;
  throw redirect(requestReferrer(args.request) ?? path.to.jobs);
}
