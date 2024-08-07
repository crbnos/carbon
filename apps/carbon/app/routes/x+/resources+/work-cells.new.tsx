import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useNavigate } from "@remix-run/react";
import {
  WorkCellTypeForm,
  upsertWorkCellType,
  workCellTypeValidator,
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

  const validation = await validator(workCellTypeValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const createWorkCellType = await upsertWorkCellType(client, {
    ...data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });
  if (createWorkCellType.error) {
    return modal
      ? json(createWorkCellType)
      : redirect(
          path.to.workCells,
          await flash(
            request,
            error(createWorkCellType.error, "Failed to create work cell type")
          )
        );
  }

  return modal ? json(createWorkCellType) : redirect(path.to.workCells);
}

export default function NewWorkCellTypeRoute() {
  const navigate = useNavigate();
  const onClose = () => navigate(path.to.workCells);

  const initialValues = {
    name: "",
    description: "",
    quotingRate: 0,
    laborRate: 0,
    overheadRate: 0,
    defaultStandardFactor: "Minutes/Piece" as "Minutes/Piece",
  };

  return <WorkCellTypeForm onClose={onClose} initialValues={initialValues} />;
}
