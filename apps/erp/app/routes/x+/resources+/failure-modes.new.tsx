import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useNavigate } from "react-router";
import { failureModeValidator, upsertFailureMode } from "~/modules/resources";
import FailureModeForm from "~/modules/resources/ui/FailureModes/FailureModeForm";
import { getParams, path, requestReferrer } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "resources"
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "resources"
  });

  const formData = await request.formData();
  const modal = formData.get("formType") === "modal";

  const validation = await validator(failureModeValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  const insertFailureMode = await upsertFailureMode(client, {
    ...d,
    companyId,
    createdBy: userId
  });
  if (insertFailureMode.error) {
    return modal
      ? insertFailureMode
      : redirect(
          requestReferrer(request) ??
            `${path.to.failureModes}?${getParams(request)}`,
          await flash(
            request,
            error(insertFailureMode.error, "Failed to insert failure mode")
          )
        );
  }

  return modal
    ? insertFailureMode
    : redirect(
        `${path.to.failureModes}?${getParams(request)}`,
        await flash(request, success("Failure mode created"))
      );
}

export default function NewFailureModeRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
    type: "Maintenance" as const
  };

  return (
    <FailureModeForm
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
