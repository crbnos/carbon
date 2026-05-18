import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { deleteGaugeCalibrationRecord } from "~/modules/quality";
import { getParams, path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermissions(request, {
    delete: "quality"
  });

  const { id } = params;

  if (!id) throw new Error("id is not found");

  const mutation = await deleteGaugeCalibrationRecord(id);
  if (mutation.error) {
    return data(
      {
        success: false
      },
      await flash(
        request,
        error(mutation.error, "Failed to delete gauge calibration record")
      )
    );
  }

  throw redirect(
    `${path.to.calibrations}?${getParams(request)}`,
    await flash(
      request,
      success("Successfully deleted gauge calibration record")
    )
  );
}
