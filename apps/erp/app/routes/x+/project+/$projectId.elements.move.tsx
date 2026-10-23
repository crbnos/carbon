// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost, error, success } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { type ActionFunctionArgs, data } from "react-router";
import { readChangeRequestId } from "~/modules/projects/projects.service";

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
 * While a change request is open, a move or a new order goes into it.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const refuse = async (message: string) =>
    data({ success: false }, await flash(request, error(null, message)));

  const formData = await request.formData();
  const intent = formData.get("intent");
  const changeRequestId = readChangeRequestId(request, formData);
  const api = await carbon(request);

  if (intent === "move") {
    const elementId = formData.get("elementId");
    const parentValue = formData.get("parentId");
    if (typeof elementId !== "string" || !elementId) {
      return refuse("No element was given");
    }
    const order = readOrderUpdates(formData);
    if (order === null) return refuse("Invalid order");

    const result = await api.projects.moveProjectElement({
      projectId,
      elementId,
      parentId:
        typeof parentValue === "string" && parentValue ? parentValue : null,
      order,
      changeRequestId
    });
    if (result.error) return refuse(result.error.message);
    return data({ success: true }, await flash(request, success("Moved")));
  }

  if (intent === "order") {
    const updates = readOrderUpdates(formData);
    if (updates === null) return refuse("Invalid order");

    const result = await api.projects.updateProjectElementOrder({
      projectId,
      updates,
      changeRequestId
    });
    if (result.error) return refuse(result.error.message);
    return data({ success: true });
  }

  return refuse("Unknown action");
}
