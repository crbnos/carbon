// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { updateProjectElementOrder } from "~/modules/projects";
import { moveProjectElement } from "~/modules/projects/projects.server";
import {
  requireServiceWork,
  ServiceOrderError
} from "~/modules/service/service.server";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "service-work-move");

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
 * The service twin of the project's `elements.move`:
 * - `move`: puts `elementId` under `parentId` (empty for the top level),
 *   after its new last sibling; with `updates`, then saves the new siblings'
 *   order (a drop between two rows of the sidebar tree).
 * - `order`: saves the sort order of siblings (`updates`, a JSON list of
 *   `{ id, sortOrder }`).
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "service"
  });
  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const refuse = async (err: unknown, message: string) =>
    data({ success: false }, await flash(request, error(err, message)));
  const failed = (err: unknown, message: string) => {
    if (err instanceof ServiceOrderError) return refuse(err, err.message);
    logger.error(message, { companyId, projectId, error: err });
    return refuse(err, message);
  };

  const formData = await request.formData();
  const intent = formData.get("intent");

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

    try {
      await requireServiceWork(client, {
        companyId,
        projectId,
        elementIds: [
          ...new Set([
            elementId,
            ...(parentId ? [parentId] : []),
            ...order.map((u) => u.id)
          ])
        ]
      });
      const siblings = client
        .from("projectElement")
        .select("sortOrder")
        .eq("projectId", projectId)
        .eq("companyId", companyId)
        .order("sortOrder", { ascending: false })
        .limit(1);
      const last = await (parentId
        ? siblings.eq("parentId", parentId)
        : siblings.is("parentId", null)
      ).maybeSingle();
      if (last.error) throw last.error;
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
      return failed(
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
      await requireServiceWork(client, {
        companyId,
        projectId,
        elementIds: updates.map((u) => u.id)
      });
      await updateProjectElementOrder(
        getDatabaseClient(),
        companyId,
        userId,
        projectId,
        updates
      );
    } catch (err) {
      return failed(err, "Failed to save the order");
    }
    return data({ success: true });
  }

  return refuse(null, "Unknown action");
}
