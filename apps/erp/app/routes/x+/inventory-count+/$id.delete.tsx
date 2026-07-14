import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { deleteInventoryCount, getInventoryCount } from "~/modules/inventory";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, { delete: "inventory" });
  return redirect(path.to.inventoryCounts);
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "inventory"
  });

  const { id } = params;
  if (!id) {
    throw redirect(
      path.to.inventoryCounts,
      await flash(request, error(params, "Failed to get a inventory count id"))
    );
  }

  // A posted count is the audit record of an adjustment — roll it back, don't delete.
  const header = await getInventoryCount(client, id, companyId);
  if (header.data?.status === "Posted") {
    throw redirect(
      path.to.inventoryCount(id),
      await flash(
        request,
        error(null, "Cannot delete a posted count. Roll it back instead.")
      )
    );
  }

  const remove = await deleteInventoryCount(client, id, companyId);
  if (remove.error) {
    throw redirect(
      `${path.to.inventoryCounts}?${getParams(request)}`,
      await flash(
        request,
        error(remove.error, "Failed to delete inventory count")
      )
    );
  }

  throw redirect(
    path.to.inventoryCounts,
    await flash(request, success("Successfully deleted inventory count"))
  );
}
