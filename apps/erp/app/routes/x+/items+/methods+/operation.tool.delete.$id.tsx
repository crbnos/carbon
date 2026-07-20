import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteMethodOperationTool } from "~/modules/items";
import { checkRevisionLock } from "~/modules/items/items.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "parts"
  });

  const { id } = params;
  if (!id) {
    throw new Error("id not found");
  }

  // Release-lock gate: enforce -> block; warn -> proceed + flash; off -> no-op.
  const lock = await checkRevisionLock(client, { kind: "tool", id, companyId });
  if (!lock.ok) {
    return data({ id: null }, await flash(request, error(null, lock.message)));
  }

  const deleteOperationTool = await deleteMethodOperationTool(client, id);
  if (deleteOperationTool.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(
          deleteOperationTool.error,
          "Failed to delete method operation tool"
        )
      )
    );
  }

  if (lock.warn) {
    return data({}, await flash(request, success(lock.message)));
  }

  return {};
}
