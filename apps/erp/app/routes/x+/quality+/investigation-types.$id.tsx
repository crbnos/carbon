import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { useLoaderData, useNavigate } from "@remix-run/react";

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  getInvestigationType,
  investigationTypeValidator,
  upsertInvestigationType,
} from "~/modules/quality";
import { InvestigationTypeForm } from "~/modules/quality/ui/InvestigationTypes";

import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { id } = params;
  if (!id) throw new Error("Investigation type ID is required");

  const { client } = await requirePermissions(request, {
    view: "quality",
    role: "employee",
  });

  const result = await getInvestigationType(client, id);
  if (!result.data) {
    return redirect(
      path.to.investigationTypes,
      await flash(request, error(result.error, "Investigation type not found"))
    );
  }

  return json({ investigationType: result.data });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { id } = params;
  if (!id) throw new Error("Investigation type ID is required");

  const { client, userId } = await requirePermissions(request, {
    update: "quality",
  });

  const formData = await request.formData();
  const validation = await validator(investigationTypeValidator).validate(
    formData
  );

  if (validation.error) {
    return json({ success: false, message: "Invalid form data" });
  }

  const { name, active } = validation.data;

  const updateResult = await upsertInvestigationType(client, {
    id,
    name,
    active: active ?? true,
    updatedBy: userId,
  });

  if (updateResult.error) {
    return redirect(
      path.to.investigationTypes,
      await flash(
        request,
        error(updateResult.error, "Failed to update investigation type")
      )
    );
  }

  return redirect(
    path.to.investigationTypes,
    await flash(request, success("Investigation type updated successfully"))
  );
}

export default function EditInvestigationTypeRoute() {
  const { investigationType } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const onClose = () => navigate(path.to.investigationTypes);

  return (
    <InvestigationTypeForm 
      type="modal"
      initialValues={investigationType} 
      onClose={onClose}
    />
  );
}
