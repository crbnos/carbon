// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { error, success } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { type ActionFunctionArgs, data } from "react-router";

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
 *   order (a drop between two rows of the sidebar tree)
 *   (`moveServiceWorkElement`).
 * - `order`: saves the sort order of siblings (`updates`, a JSON list of
 *   `{ id, sortOrder }`) (`orderServiceWorkElements`).
 */
export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["projectId"] });
  if ("invalid" in input) return input.invalid;
  const { projectId } = input.params;
  const refuse = async (message: string) =>
    data({ success: false }, await flash(args.request, error(null, message)));

  const formData = await args.request.formData();
  const intent = formData.get("intent");
  const api = await carbon(args.request);

  if (intent === "move") {
    const elementId = formData.get("elementId");
    const parentValue = formData.get("parentId");
    if (typeof elementId !== "string" || !elementId) {
      return refuse("No element was given");
    }
    const order = readOrderUpdates(formData);
    if (order === null) return refuse("Invalid order");

    const result = await api.service.moveServiceWorkElement({
      projectId,
      elementId,
      parentId:
        typeof parentValue === "string" && parentValue ? parentValue : null,
      order
    });
    if (result.error) return refuse(result.error.message);
    return data({ success: true }, await flash(args.request, success("Moved")));
  }

  if (intent === "order") {
    const updates = readOrderUpdates(formData);
    if (updates === null) return refuse("Invalid order");
    if (updates.length === 0) return data({ success: true });

    const result = await api.service.orderServiceWorkElements({
      projectId,
      updates
    });
    if (result.error) return refuse(result.error.message);
    return data({ success: true });
  }

  return refuse("Unknown action");
}
