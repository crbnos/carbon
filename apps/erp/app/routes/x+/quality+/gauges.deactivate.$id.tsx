import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { deactivateGauge } from "~/modules/quality/quality.service.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermissions(request, {
    delete: "quality"
  });

  const { id } = params;

  if (!id) throw new Error("id is not found");

  const mutation = await deactivateGauge(id);
  if (mutation.error) {
    return data(
      {
        success: false
      },
      await flash(request, error(mutation.error, "Failed to deactivate gauge"))
    );
  }

  throw redirect(
    path.to.gauges,
    await flash(request, success("Successfully deactivated gauge"))
  );
}
