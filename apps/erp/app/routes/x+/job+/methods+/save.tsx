// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getJobMethodValidator } from "~/modules/production/production.models";
import { path, requestReferrer } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(getJobMethodValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const type = input.formData?.get("type");
  const { sourceId, targetId, ...parts } = input.data;
  const method = {
    sourceId,
    targetId,
    parts: {
      billOfMaterial: parts.billOfMaterial,
      billOfProcess: parts.billOfProcess,
      parameters: parts.parameters,
      tools: parts.tools,
      steps: parts.steps,
      workInstructions: parts.workInstructions
    }
  };
  const production = (await carbon(args.request)).production;

  if (type === "job") {
    return production.upsertMakeMethodFromJob(method);
  }

  if (type === "method") {
    const result = await production.upsertMakeMethodFromJobMethod(method);
    if (result.error) return result;
    throw redirect(requestReferrer(args.request) ?? path.to.jobs);
  }

  return data({ error: "Invalid type" }, { status: 400 });
}
