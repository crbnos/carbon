import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteMethodMaterial } from "~/modules/items";
import { checkRevisionLock } from "~/modules/items/items.server";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "parts"
  });

  const formData = await request.formData();
  const ids = formData.getAll("ids").map(String).filter(Boolean);

  if (ids.length === 0) {
    return data({ error: "Material IDs are required" }, { status: 400 });
  }

  // Release-lock gate: block edits to a released (Production) revision unless a
  // change notice is used. enforce -> block; warn -> proceed + flash; off -> no-op.
  let lockWarning: string | null = null;
  for (const id of ids) {
    const lock = await checkRevisionLock(client, {
      kind: "material",
      id,
      companyId
    });
    if (!lock.ok) {
      return data(
        { id: null },
        await flash(request, error(null, lock.message))
      );
    }
    if (lock.warn) {
      lockWarning = lock.message;
    }
  }

  const deleteMaterials = await deleteMethodMaterial(client, ids);
  if (deleteMaterials.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(deleteMaterials.error, "Failed to delete method materials")
      )
    );
  }

  if (lockWarning) {
    return data({}, await flash(request, success(lockWarning)));
  }

  return {};
}
