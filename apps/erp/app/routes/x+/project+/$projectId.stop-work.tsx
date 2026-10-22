// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { requireFeature } from "@carbon/ee/plan.server";
import { stopWorkValidator } from "@carbon/ee/project-control";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { path, requestReferrer } from "~/utils/path";

const logger = getLogger("erp", "project-stop-work");

/**
 * Stop-work orders (Government Contracting 5c, FAR 52.242-15).
 * - `stop`: sets a Released Direct project On Hold with the order date.
 *   Commercial: `requireFeature` here, `requireEntitlement` in the ee function.
 * - `resume`: returns the project to Released. Not gated, so a company that
 *   loses the feature can still release a stopped project.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    update: "projects"
  });

  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");
  const back = requestReferrer(request) ?? path.to.project(projectId);

  const formData = await request.formData();
  const intent = formData.get("intent");
  const api = await carbon(request);

  if (intent === "stop") {
    await requireFeature({
      request,
      client,
      companyId,
      redirectTo: back,
      feature: "GOVERNMENT_CONTRACTING"
    });
    formData.set("projectId", projectId);
    const validation = await validator(stopWorkValidator).validate(formData);
    if (validation.error) {
      throw redirect(
        back,
        await flash(
          request,
          error(
            null,
            Object.values(validation.error.fieldErrors)[0] ??
              "Invalid stop-work order"
          )
        )
      );
    }
    const result = await api.projects.stopProjectWork(validation.data);
    if (result.error) {
      logger.error("Failed to stop work", {
        companyId,
        projectId,
        error: result.error
      });
    }
    return respond(request, result).redirect(back, {
      message: "Stop-work order issued"
    });
  }

  if (intent === "resume") {
    const result = await api.projects.resumeProjectWork({ projectId });
    if (result.error) {
      logger.error("Failed to resume work", {
        companyId,
        projectId,
        error: result.error
      });
    }
    return respond(request, result).redirect(back, {
      message: "Work resumed"
    });
  }

  throw redirect(back, await flash(request, error(null, "Unknown action")));
}
