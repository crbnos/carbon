import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { cancelPrepaidSchedule } from "~/modules/accounting";
import { getParams, path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const { prepaidScheduleId } = params;
  if (!prepaidScheduleId) {
    throw redirect(
      `${path.to.prepaidSchedules}?${getParams(request)}`,
      await flash(request, error(params, "Failed to get a prepaid schedule id"))
    );
  }

  const result = await cancelPrepaidSchedule(client, {
    id: prepaidScheduleId,
    companyId,
    userId
  });

  if (result.error) {
    throw redirect(
      path.to.prepaidSchedule(prepaidScheduleId),
      await flash(
        request,
        error(result.error, "Failed to cancel prepaid schedule")
      )
    );
  }

  throw redirect(
    path.to.prepaidSchedule(prepaidScheduleId),
    await flash(request, success("Prepaid schedule cancelled"))
  );
}
