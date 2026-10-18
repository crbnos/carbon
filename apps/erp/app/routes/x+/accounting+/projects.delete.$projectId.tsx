// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/api/carbon.server";
import { error, notFound, success } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteProject } from "~/modules/accounting/accounting.service";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
    view: "accounting"
  });
  const { projectId } = params;
  if (!projectId) throw notFound("projectId not found");

  const project = await api.accounting.getProject({ projectId });
  if (project.error) {
    throw redirect(
      `${path.to.projects}?${getParams(request)}`,
      await flash(request, error(project.error, "Failed to get project"))
    );
  }

  return { project: project.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await authorize(request, {
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
      text={t`Are you sure you want to delete the project: ${project.name}? It will be deactivated and hidden from active lists.`}
      onCancel={onCancel}
    />
  );
}
