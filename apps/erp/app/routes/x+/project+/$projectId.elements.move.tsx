// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getProject, updateProjectElementOrder } from "~/modules/projects";
import {
  moveElementInChangeRequest,
  moveProjectElement,
  orderElementsInChangeRequest,
  readChangeRequestId,
  requireEditablePlanRoute
} from "~/modules/projects/projects.server";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "project-element-move");

/** The `updates` field: a JSON list of `{ id, sortOrder }`; null when invalid. */
function readOrderUpdates(
  formData: FormData
): { id: string; sortOrder: number }[] | null {
  try {
    const parsed = JSON.parse(String(formData.get("updates") ?? "[]"));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (u): u is { id: string; sortOrder: number } =>
          typeof u?.id === "string" && Number.isFinite(Number(u?.sortOrder))
      )
      .map((u) => ({ id: u.id, sortOrder: Number(u.sortOrder) }));
  } catch {
    return null;
  }
}

/**
 * Two intents:
 * - `move`: puts `elementId` under `parentId` (empty for the top level), after
 *   its new last sibling; with `updates`, then saves the new siblings' order
 *   (a drop between two rows of the sidebar tree).
 * - `order`: saves the sort order of siblings (`updates`, a JSON list of
 *   `{ id, sortOrder }`).
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "projects"
  });

  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const refuse = async (err: unknown, message: string) =>
    data({ success: false }, await flash(request, error(err, message)));

  const project = await getProject(client, companyId, projectId);
  if (project.error || !project.data) {
    logger.error("Failed to load project", {
      companyId,
      projectId,
      error: project.error
    });
    return refuse(project.error, "Failed to load the project");
  }
  if (project.data.status === "Closed") {
    return refuse(null, "A Closed project cannot change");
  }

  const formData = await request.formData();
  const intent = formData.get("intent");
  // While a change request is open, a move or a new order goes into it.
  const changeRequestId = readChangeRequestId(request, formData);
  // A locked plan takes plan-layer changes only through a change request.
  const locked = await requireEditablePlanRoute(request, {
    client,
    projectId,
    companyId,
    changeRequestId
  });
  if (locked) return locked;

  if (intent === "move") {
    const elementId = formData.get("elementId");
    const parentValue = formData.get("parentId");
    if (typeof elementId !== "string" || !elementId) {
      return refuse(null, "No element was given");
    }
    const parentId =
      typeof parentValue === "string" && parentValue ? parentValue : null;
    const order = readOrderUpdates(formData);
    if (order === null) return refuse(null, "Invalid order");

    if (changeRequestId) {
      try {
        await moveElementInChangeRequest(getDatabaseClient(), {
          companyId,
          userId,
          projectId,
          changeRequestId,
          elementId,
          parentId
        });
        if (order.length > 0) {
          await orderElementsInChangeRequest(getDatabaseClient(), {
            companyId,
            userId,
            projectId,
            changeRequestId,
            updates: order
          });
        }
      } catch (err) {
        logger.error("Failed to move an element in a change request", {
          companyId,
          projectId,
          changeRequestId,
          error: err
        });
        return refuse(
          err,
          err instanceof Error ? err.message : "Failed to move the element"
        );
      }
      return data({ success: true }, await flash(request, success("Moved")));
    }

    let lastSibling = client
      .from("projectElement")
      .select("sortOrder")
      .eq("projectId", projectId)
      .eq("companyId", companyId)
      .order("sortOrder", { ascending: false })
      .limit(1);
    lastSibling = parentId
      ? lastSibling.eq("parentId", parentId)
      : lastSibling.is("parentId", null);
    const last = await lastSibling.maybeSingle();
    if (last.error) {
      logger.error("Failed to read sibling order", {
        companyId,
        projectId,
        error: last.error
      });
      return refuse(last.error, "Failed to move the element");
    }

    try {
      await moveProjectElement(getDatabaseClient(), {
        companyId,
        userId,
        projectId,
        elementId,
        parentId,
        sortOrder: Number(last.data?.sortOrder ?? 0) + 1
      });
      if (order.length > 0) {
        await updateProjectElementOrder(
          getDatabaseClient(),
          companyId,
          userId,
          projectId,
          order
        );
      }
    } catch (err) {
      logger.error("Failed to move element", {
        companyId,
        projectId,
        elementId,
        error: err
      });
      return refuse(
        err,
        err instanceof Error ? err.message : "Failed to move the element"
      );
    }
    return data({ success: true }, await flash(request, success("Moved")));
  }

  if (intent === "order") {
    const updates = readOrderUpdates(formData);
    if (updates === null) return refuse(null, "Invalid order");
    if (updates.length === 0) return data({ success: true });

    try {
      if (changeRequestId) {
        await orderElementsInChangeRequest(getDatabaseClient(), {
          companyId,
          userId,
          projectId,
          changeRequestId,
          updates
        });
        return data({ success: true });
      }
      await updateProjectElementOrder(
        getDatabaseClient(),
        companyId,
        userId,
        projectId,
        updates
      );
    } catch (err) {
      logger.error("Failed to save element order", {
        companyId,
        projectId,
        error: err
      });
      return refuse(
        err,
        err instanceof Error && changeRequestId
          ? err.message
          : "Failed to save the order"
      );
    }
    return data({ success: true });
  }

  return refuse(null, "Unknown action");
}
