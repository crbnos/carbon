// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteProjectElement } from "~/modules/projects";
import {
  requireServiceWork,
  ServiceOrderError
} from "~/modules/service/service.server";

const logger = getLogger("erp", "service-work-delete");

/**
 * Deletes an element of a service order's or a service template's work and
 * everything below it, then goes back to the work. An element with charges
 * cannot be deleted; the refusal stays on the page with its reason.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    update: "service"
  });
  const { projectId, elementId } = params;
  if (!projectId) throw new Error("Could not find projectId");
  if (!elementId) throw new Error("Could not find elementId");

  let workPath: string;
  try {
    ({ workPath } = await requireServiceWork(client, {
      companyId,
      projectId,
      elementIds: [elementId]
    }));
  } catch (err) {
    if (!(err instanceof ServiceOrderError)) {
      logger.error("Failed to load the service work", {
        companyId,
        projectId,
        error: err
      });
    }
    return data(
      { success: false },
      await flash(
        request,
        error(err, err instanceof Error ? err.message : "Failed to delete")
      )
    );
  }

  const result = await deleteProjectElement(client, elementId, companyId);
  if (result.error) {
    logger.error("Failed to delete a service element", {
      companyId,
      projectId,
      elementId,
      error: result.error
    });
    return data(
      { success: false },
      await flash(
        request,
        error(result.error, result.error.message ?? "Failed to delete")
      )
    );
  }

  throw redirect(workPath, await flash(request, success("Element deleted")));
}
