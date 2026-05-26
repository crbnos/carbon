import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { deleteGauge } from "~/modules/quality/quality.service.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermissions(request, {
    delete: "quality"
  });

  const { id } = params;

  if (!id) throw new Error("id is not found");

  const mutation = await deleteGauge(id);
  if (mutation.error) {
    return data(
      {
        success: false
      },
      await flash(request, error(mutation.error, "Failed to delete gauge"))
    );
  }

  throw redirect(
    path.to.gauges,
    await flash(request, success("Successfully deleted gauge"))
  );
}
