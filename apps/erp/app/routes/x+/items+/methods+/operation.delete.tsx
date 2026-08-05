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
  const id = formData.get("id") as string | null;
  const ids = [
    ...formData.getAll("ids").map(String),
    ...(id ? [id] : [])
  ].filter(Boolean);

  if (ids.length === 0) {
    return data(
      { error: "Operation ID is required" },
      {
        status: 400
      }
    );
  }

  // Release-lock gate: enforce -> block; warn -> proceed + flash; off -> no-op.
  let lockWarning: string | null = null;
  for (const operationId of ids) {
    const lock = await checkRevisionLock(client, {
      kind: "operation",
      id: operationId,
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
    if (lock.warn) {
      lockWarning = lock.message;
    }
  }

  const { error } = await client.from("methodOperation").delete().in("id", ids);

  if (error) {
    return data(
      { success: false, error: error.message },
      {
        status: 400
      }
    );
  }

  if (lockWarning) {
    return data({ success: true }, await flash(request, success(lockWarning)));
  }

  return { success: true };
}
