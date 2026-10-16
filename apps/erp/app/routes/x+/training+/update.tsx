// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { unchecked } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import {
  isValidTrainingGuideKey,
  trainingGuideKeyPrefix
} from "~/modules/resources";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "people"
  });

  const formData = await request.formData();
  const ids = formData.getAll("ids");
  const field = formData.get("field");
  const value = formData.get("value");

  if (typeof field !== "string" || typeof value !== "string") {
    return { error: { message: "Invalid form data" }, data: null };
  }

  switch (field) {
    case "content":
    case "name":
    case "status":
    case "type":
    case "frequency":
    case "estimatedDuration":
    case "description":
      return await client
        .from("training")
        .update(
          unchecked({
            [field]: value,
            updatedBy: userId,
            updatedAt: new Date().toISOString()
          })
        )
        .in("id", ids as string[]);
    case "grantsAbilityId":
      return await client
        .from("training")
        .update({
          grantsAbilityId: value === "" ? null : value,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .in("id", ids as string[]);
    case "guidePath": {
      const trainingId = ids[0] as string;
      if (
        ids.length !== 1 ||
        (value !== "" &&
          !isValidTrainingGuideKey(
            value,
            trainingGuideKeyPrefix(companyId, trainingId)
          ))
      ) {
        return { error: { message: "Invalid guide file" }, data: null };
      }
      // The guide is the training's content, so it changes only while Draft.
      // Filtering the update on status makes the check and the write one step.
      const updated = await client
        .from("training")
        .update({
          guidePath: value === "" ? null : value,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .eq("id", trainingId)
        .eq("companyId", companyId)
        .eq("status", "Draft")
        .select("id");
      if (updated.error) return updated;
      if (updated.data.length === 0) {
        return {
          error: {
            message: "The guide can only change while the training is Draft"
          },
          data: null
        };
      }
      return updated;
    }
    case "tags":
      return await client
        .from("training")
        .update({
          [field]: formData.getAll("value") as string[],
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .in("id", ids as string[]);

    default:
      return { error: { message: "Invalid field" }, data: null };
  }
}
