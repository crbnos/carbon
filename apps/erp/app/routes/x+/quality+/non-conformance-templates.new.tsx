import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { nonConformanceTemplateValidator } from "~/modules/quality/quality.models";
import { upsertNonConformanceTemplate } from "~/modules/quality/quality.service";
import NonConformanceTemplateForm from "~/modules/quality/ui/NonConformanceTemplates/NonConformanceTemplateForm";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "quality",
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "quality",
  });
  const formData = await request.formData();
  const validation = await validator(nonConformanceTemplateValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const insertNonConformanceTemplate = await upsertNonConformanceTemplate(
    client,
    {
      ...data,
      companyId,
      createdBy: userId,
    }
  );

  if (
    insertNonConformanceTemplate.error ||
    !insertNonConformanceTemplate.data?.id
  ) {
    return json(
      {},
      await flash(
        request,
        error(
          insertNonConformanceTemplate.error,
          "Failed to insert non-conformance template"
        )
      )
    );
  }

  return redirect(
    path.to.nonConformanceTemplate(insertNonConformanceTemplate.data.id),
    await flash(request, success("Non-conformance template created"))
  );
}

export default function NewNonConformanceTemplateRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
    version: 0,
    processId: "",
  };

  return (
    <NonConformanceTemplateForm
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
