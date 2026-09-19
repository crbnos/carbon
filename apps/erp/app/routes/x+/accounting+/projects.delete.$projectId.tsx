import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteProject, getProject } from "~/modules/accounting";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting"
  });
  const { projectId } = params;
  if (!projectId) throw notFound("projectId not found");

  const project = await getProject(client, companyId, projectId);
  if (project.error) {
    throw redirect(
      `${path.to.projects}?${getParams(request)}`,
      await flash(request, error(project.error, "Failed to get project"))
    );
  }

  return { project: project.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    delete: "accounting"
  });

  const { projectId } = params;
  if (!projectId) {
    throw redirect(
      `${path.to.projects}?${getParams(request)}`,
      await flash(request, error(params, "Failed to get a project id"))
    );
  }

  const { error: deleteProjectError } = await deleteProject(
    client,
    companyId,
    projectId,
    userId
  );
  if (deleteProjectError) {
    throw redirect(
      `${path.to.projects}?${getParams(request)}`,
      await flash(
        request,
        error(deleteProjectError, "Failed to delete project")
      )
    );
  }

  throw redirect(
    `${path.to.projects}?${getParams(request)}`,
    await flash(request, success("Successfully deleted project"))
  );
}

export default function DeleteProjectRoute() {
  const { projectId } = useParams();
  const { project } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();

  if (!projectId || !project) return null;

  const onCancel = () => navigate(path.to.projects);

  return (
    <ConfirmDelete
      action={path.to.deleteProject(projectId)}
      name={project.name}
      text={t`Are you sure you want to delete the project: ${project.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
