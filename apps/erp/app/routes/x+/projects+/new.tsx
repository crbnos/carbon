// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData, useNavigate } from "react-router";
import { COST_OBJECTIVE_REQUIRED, projectValidator } from "~/modules/projects";
import { copyProject, createProject } from "~/modules/projects/projects.server";
import { ProjectForm } from "~/modules/projects/ui/Projects";
import { getCompanySettings } from "~/modules/settings";
import { getDatabaseClient } from "~/services/database.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "projects");

export const handle: Handle = {
  breadcrumb: msg`New Project`,
  to: path.to.newProject
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "projects"
  });

  // The projects a new one can copy: templates first.
  const projects = await client
    .from("project")
    .select("id, name, identifier, isTemplate")
    .eq("companyId", companyId)
    .eq("projectType", "Standard")
    .eq("active", true)
    .order("isTemplate", { ascending: false })
    .order("name", { ascending: true });
  if (projects.error) {
    logger.error("Failed to load the projects to copy from", {
      companyId,
      error: projects.error
    });
  }

  const copyFrom = new URL(request.url).searchParams.get("copyFrom");
  const copyFromProjects = projects.data ?? [];
  return {
    copyFromProjects,
    copyFromProjectId: copyFromProjects.some((p) => p.id === copyFrom)
      ? copyFrom
      : null
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "projects"
  });

  const formData = await request.formData();
  const validation = await validator(projectValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // DCAA timekeeping: every project needs a cost objective.
  if (!validation.data.costObjective) {
    const settings = await getCompanySettings(client, companyId);
    if (settings.data?.timekeepingControls === "DCAA") {
      return validationError({
        fieldErrors: { costObjective: COST_OBJECTIVE_REQUIRED }
      });
    }
  }

  const { id: _id, ...project } = validation.data;
  const copyFromProjectId = formData.get("copyFromProjectId");

  let projectId: string;
  try {
    projectId =
      typeof copyFromProjectId === "string" && copyFromProjectId
        ? await copyProject(getDatabaseClient(), {
            ...project,
            companyId,
            userId,
            sourceProjectId: copyFromProjectId
          })
        : await createProject(getDatabaseClient(), {
            ...project,
            companyId,
            userId
          });
  } catch (err) {
    logger.error("Failed to create project", { companyId, error: err });
    return data(
      {},
      await flash(
        request,
        error(
          err,
          "Failed to create the project. Check that its identifier is not in use."
        )
      )
    );
  }

  throw redirect(
    path.to.projectElements(projectId),
    await flash(request, success("Project created"))
  );
}

export default function NewProjectRoute() {
  const { t } = useLingui();
  const navigate = useNavigate();
  const { copyFromProjects, copyFromProjectId } =
    useLoaderData<typeof loader>();

  return (
    <ProjectForm
      initialValues={{ name: "", costTreatment: "Statistical" }}
      copyFrom={{
        defaultValue: copyFromProjectId ?? undefined,
        options: copyFromProjects.map((project) => ({
          value: project.id,
          label: project.isTemplate
            ? t`${project.name} (template)`
            : project.identifier
              ? `${project.name} (${project.identifier})`
              : project.name
        }))
      }}
      onClose={() => navigate(path.to.projects)}
    />
  );
}
