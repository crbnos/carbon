import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import {
  failureModeValidator,
  getFailureMode,
  upsertFailureMode
} from "~/modules/resources";
import FailureModeForm from "~/modules/resources/ui/FailureModes/FailureModeForm";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "resources",
    role: "employee"
  });

  const { failureModeId } = params;
  if (!failureModeId) throw notFound("failureModeId not found");

  const failureMode = await getFailureMode(client, failureModeId);

  if (failureMode.error) {
    throw redirect(
      path.to.failureModes,
      await flash(
        request,
        error(failureMode.error, "Failed to get failure mode")
      )
    );
  }

  return {
    failureMode: failureMode.data
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "resources"
  });

  const formData = await request.formData();
  const validation = await validator(failureModeValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw new Error("id not found");

  const updateFailureMode = await upsertFailureMode(client, {
    id,
    ...d,
    updatedBy: userId
  });

  if (updateFailureMode.error) {
    return data(
      {},
      await flash(
        request,
        error(updateFailureMode.error, "Failed to update failure mode")
      )
    );
  }

  throw redirect(
    path.to.failureModes,
    await flash(request, success("Updated failure mode"))
  );
}

export default function EditFailureModeRoute() {
  const { failureMode } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: failureMode.id ?? undefined,
    name: failureMode.name ?? "",
    type: failureMode.type ?? "Maintenance"
  };

  return (
    <FailureModeForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
