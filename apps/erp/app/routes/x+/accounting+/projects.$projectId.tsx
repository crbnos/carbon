import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import {
  getProject,
  projectValidator,
  upsertProject
} from "~/modules/accounting";
import { ProjectForm } from "~/modules/accounting/ui/Projects";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const { projectId } = params;
  if (!projectId) throw notFound("projectId not found");

  const project = await getProject(client, companyId, projectId);

  return {
    project: project?.data ?? null
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const { projectId } = params;
  if (!projectId) throw notFound("projectId not found");

  const formData = await request.formData();
  const validation = await validator(projectValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw new Error("id not found");

  const updateProject = await upsertProject(client, {
    id,
    ...d,
    companyId,
    updatedBy: userId
  });

  if (updateProject.error) {
    return data(
      {},
      await flash(
        request,
        error(updateProject.error, "Failed to update project")
      )
    );
  }

  throw redirect(
    `${path.to.projects}?${getParams(request)}`,
    await flash(request, success("Updated project"))
  );
}

export default function EditProjectRoute() {
  const { project } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: project?.id ?? undefined,
    name: project?.name ?? "",
    description: project?.description ?? ""
  };

  return (
    <ProjectForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
