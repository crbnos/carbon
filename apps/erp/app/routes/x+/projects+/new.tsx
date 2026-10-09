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
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useNavigate } from "react-router";
import { projectValidator } from "~/modules/projects";
import { createProject } from "~/modules/projects/projects.server";
import { ProjectForm } from "~/modules/projects/ui/Projects";
import { getDatabaseClient } from "~/services/database.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "projects");

export const handle: Handle = {
  breadcrumb: msg`New Project`,
  to: path.to.newProject
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, { create: "projects" });
  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "projects"
  });

  const formData = await request.formData();
  const validation = await validator(projectValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, ...project } = validation.data;

  let projectId: string;
  try {
    projectId = await createProject(getDatabaseClient(), {
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
  const navigate = useNavigate();

  return (
    <ProjectForm
      initialValues={{ name: "", costTreatment: "Statistical" }}
      onClose={() => navigate(path.to.projects)}
    />
  );
}
