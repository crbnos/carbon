import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useNavigate } from "react-router";
import { projectValidator, upsertProject } from "~/modules/accounting";
import { ProjectForm } from "~/modules/accounting/ui/Projects";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "accounting"
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "accounting"
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(projectValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: strip id from the create payload
  const { id, ...rest } = validation.data;

  const insertProject = await upsertProject(client, {
    ...rest,
    companyId,
    createdBy: userId
  });
  if (insertProject.error) {
    return data(
      {},
      await flash(
        request,
        error(insertProject.error, "Failed to insert project")
      )
    );
  }

  return modal
    ? data(insertProject, { status: 201 })
    : redirect(
        `${path.to.projects}?${getParams(request)}`,
        await flash(request, success("Project created"))
      );
}

export default function NewProjectRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
    description: ""
  };

  return (
    <ProjectForm initialValues={initialValues} onClose={() => navigate(-1)} />
  );
}
