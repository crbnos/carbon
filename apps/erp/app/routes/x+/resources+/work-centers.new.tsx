// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { useNavigate } from "react-router";
import { useUser } from "~/hooks";
import { notifyScheduleInputsChanged } from "~/modules/production";
import {
  upsertWorkCenter,
  WorkCenterForm,
  workCenterValidator
} from "~/modules/resources";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

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

  await notifyScheduleInputsChanged(
    companyId,
    "work-center",
    "Work center hours changed",
    createWorkCenter.data?.id
  );

  return modal ? createWorkCenter : redirect(path.to.workCenters);
}

export default function NewWorkCenterRoute() {
  const navigate = useNavigate();
  const onClose = () => navigate(path.to.workCenters);
  const { defaults } = useUser();

  const initialValues = {
    alwaysOn: false,
    defaultStandardFactor: "Minutes/Piece" as "Minutes/Piece",
    departmentId: undefined as string | undefined,
    description: "",
    laborRate: 0,
    locationId: defaults?.locationId ?? "",
    machineRate: 0,
    name: "",
    overheadRate: 0,
    processes: [],
    shifts: [],
    batchCapacity: undefined as number | undefined,
    minimumBatchQuantity: undefined as number | undefined
  };

  return <WorkCenterForm onClose={onClose} initialValues={initialValues} />;
}
