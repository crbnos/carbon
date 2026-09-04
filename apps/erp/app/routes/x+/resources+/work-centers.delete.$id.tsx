import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type {
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { redirect } from "react-router";
import { notifyScheduleInputsChanged } from "~/modules/production";
import { deleteWorkCenter } from "~/modules/resources";
import { path } from "~/utils/path";
import { getCompanyId, workCentersQuery } from "~/utils/react-query";

export async function action({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "resources"
  });

  const { id } = params;
  if (!id) {
    throw redirect(
      path.to.workCenters,
      await flash(request, error(params, "Failed to get a work center id"))
    );
  }

  const deactivateWorkCenter = await deleteWorkCenter(client, id);
  if (deactivateWorkCenter.error) {
    throw redirect(
      path.to.workCenters,
      await flash(
        request,
        error(deactivateWorkCenter.error, deactivateWorkCenter.error.details)
      )
    );
  }

  await notifyScheduleInputsChanged(
    companyId,
    "work-center",
    "Work center deactivated",
    id
  );

  throw redirect(
    path.to.workCenters,
    await flash(request, success("Successfully deactivated work center"))
  );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(
    workCentersQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}
