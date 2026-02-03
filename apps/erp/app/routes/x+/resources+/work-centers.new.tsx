import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs
} from "react-router";
import { redirect, useNavigate } from "react-router";
import { useUser } from "~/hooks";
import {
  upsertWorkCenter,
  WorkCenterForm,
  workCenterValidator
} from "~/modules/resources";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";
import { getCompanyId, workCentersQuery } from "~/utils/react-query";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "resources"
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(workCenterValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  const createWorkCenter = await upsertWorkCenter(client, {
    ...d,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });
  if (createWorkCenter.error) {
    return modal
      ? createWorkCenter
      : redirect(
          path.to.workCenters,
          await flash(
            request,
            error(createWorkCenter.error, "Failed to create work center")
          )
        );
  }

  return modal ? createWorkCenter : redirect(path.to.workCenters);
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(
    workCentersQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function NewWorkCenterRoute() {
  const navigate = useNavigate();
  const onClose = () => navigate(path.to.workCenters);
  const { defaults } = useUser();

  const initialValues = {
    defaultStandardFactor: "Minutes/Piece" as "Minutes/Piece",
    description: "",
    laborRate: 0,
    locationId: defaults?.locationId ?? "",
    machineRate: 0,
    name: "",
    overheadRate: 0,
    processes: []
  };

  return <WorkCenterForm onClose={onClose} initialValues={initialValues} />;
}
