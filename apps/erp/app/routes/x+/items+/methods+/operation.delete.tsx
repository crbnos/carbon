import { success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { checkRevisionLock } from "~/modules/items/items.server";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "parts"
  });

  const formData = await request.formData();
  const id = formData.get("id") as string;

  if (!id) {
    return data(
      { error: "Operation ID is required" },
      {
        status: 400
      }
    );
  }

  // Release-lock gate: enforce -> block; warn -> proceed + flash; off -> no-op.
  const lock = await checkRevisionLock(client, {
    kind: "operation",
    id,
    companyId
  });
  if (!lock.ok) {
    return data(
      { success: false, error: lock.message },
      {
        status: 400
      }
    );
  }

  const { error } = await client.from("methodOperation").delete().eq("id", id);

  if (error) {
    return data(
      { success: false, error: error.message },
      {
        status: 400
      }
    );
  }

  if (lock.warn) {
    return data({ success: true }, await flash(request, success(lock.message)));
  }

  return { success: true };
}
