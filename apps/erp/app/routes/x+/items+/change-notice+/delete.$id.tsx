import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { deleteChangeNotice } from "~/modules/items";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    delete: "parts"
  });

  const { id } = params;
  if (!id) throw new Error("id is not found");

  const mutation = await deleteChangeNotice(getDatabaseClient(), id, companyId);
  if (mutation.error) {
    return data(
      { success: false },
      await flash(
        request,
        error(mutation.error, "Failed to delete change notice")
      )
    );
  }

  throw redirect(
    path.to.changeNotices,
    await flash(request, success("Successfully deleted change notice"))
  );
}
