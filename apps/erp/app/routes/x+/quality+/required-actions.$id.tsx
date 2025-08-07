import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { useLoaderData, useNavigate } from "@remix-run/react";

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  getRequiredAction,
  requiredActionValidator,
  upsertRequiredAction,
} from "~/modules/quality";
import { RequiredActionForm } from "~/modules/quality/ui/RequiredActions";

import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { id } = params;
  if (!id) throw new Error("Required action ID is required");

  const { client } = await requirePermissions(request, {
    view: "quality",
    role: "employee",
  });

  const result = await getRequiredAction(client, id);
  if (!result.data) {
    return redirect(
      path.to.requiredActions,
      await flash(request, error(result.error, "Required action not found"))
    );
  }

  return json({ requiredAction: result.data });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { id } = params;
  if (!id) throw new Error("Required action ID is required");

  const { client, userId } = await requirePermissions(request, {
    update: "quality",
  });

  const formData = await request.formData();
  const validation = await validator(requiredActionValidator).validate(
    formData
  );

  if (validation.error) {
    return json({ success: false, message: "Invalid form data" });
  }

  const { name, active } = validation.data;

  const updateResult = await upsertRequiredAction(client, {
    id,
    name,
    active: active ?? true,
    updatedBy: userId,
  });

  if (updateResult.error) {
    return redirect(
      path.to.requiredActions,
      await flash(
        request,
        error(updateResult.error, "Failed to update required action")
      )
    );
  }

  return redirect(
    path.to.requiredActions,
    await flash(request, success("Required action updated successfully"))
  );
}

export default function EditRequiredActionRoute() {
  const { requiredAction } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const onClose = () => navigate(path.to.requiredActions);

  return (
    <RequiredActionForm 
      type="modal"
      initialValues={requiredAction} 
      onClose={onClose}
    />
  );
}