import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { deleteProductionEvent } from "~/modules/production";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    delete: "production"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const deletion = await deleteProductionEvent(client, id, companyId, userId);
  if (deletion.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.jobs,
      await flash(request, error(deletion.error, "Failed to delete event"))
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.jobs,
    await flash(request, success("Successfully deleted event"))
  );
}
