import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteMethodOperationParameter } from "~/modules/items";
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
  const lock = await checkRevisionLock(client, {
    kind: "parameter",
    id,
    companyId
  });
  if (!lock.ok) {
    return data({ id: null }, await flash(request, error(null, lock.message)));
  }

  const deleteOperationParameter = await deleteMethodOperationParameter(
    client,
    id
  );
  if (deleteOperationParameter.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(
          deleteOperationParameter.error,
          "Failed to delete method operation parameter"
        )
      )
    );
  }

  if (lock.warn) {
    return data({}, await flash(request, success(lock.message)));
  }

  return {};
}
