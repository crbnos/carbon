import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useNavigate } from "@remix-run/react";
import {
  WorkCenterForm,
  upsertWorkCenter,
  workCenterValidator,
} from "~/modules/resources";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "resources",
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(workCenterValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const createWorkCenter = await upsertWorkCenter(client, {
    ...data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });
  if (createWorkCenter.error) {
    return modal
      ? json(createWorkCenter)
      : redirect(
          path.to.workCenters,
          await flash(
            request,
            error(createWorkCenter.error, "Failed to create work cell type")
          )
        );
  }

  return modal ? json(createWorkCenter) : redirect(path.to.workCenters);
}

export default function NewWorkCenterRoute() {
  const navigate = useNavigate();
  const onClose = () => navigate(path.to.workCenters);

  const initialValues = {
    name: "",
    description: "",
    quotingRate: 0,
    laborRate: 0,
    overheadRate: 0,
    defaultStandardFactor: "Minutes/Piece" as "Minutes/Piece",
    processes: [],
  };

  return <WorkCenterForm onClose={onClose} initialValues={initialValues} />;
}
