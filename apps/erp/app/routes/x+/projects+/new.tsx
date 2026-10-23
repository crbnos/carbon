// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { redirect, WBS_TEMPLATES } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import {
  type ActionFunctionArgs,
  data,
  type LoaderFunctionArgs,
  useLoaderData,
  useNavigate
} from "react-router";
import {
  COST_OBJECTIVE_REQUIRED,
  projectValidator
} from "~/modules/projects/projects.models";
import { ProjectForm } from "~/modules/projects/ui/Projects";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

/** A Copy from value that names a MIL-STD-881F template, not a project. */
const WBS_TEMPLATE_PREFIX = "wbs:";

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

export async function action(args: ActionFunctionArgs) {
  const input = await validator(projectValidator).request(args);
  if ("invalid" in input) return input.invalid;

  const copyFromProjectId = input.formData?.get("copyFromProjectId");
  // `wbs:<key>` starts the plan from a MIL-STD-881F template.
  const wbsTemplateKey =
    typeof copyFromProjectId === "string" &&
    copyFromProjectId.startsWith(WBS_TEMPLATE_PREFIX)
      ? copyFromProjectId.slice(WBS_TEMPLATE_PREFIX.length)
      : undefined;
  const sourceProjectId =
    typeof copyFromProjectId === "string" &&
    copyFromProjectId &&
    !wbsTemplateKey
      ? copyFromProjectId
      : undefined;

  const api = await carbon(args.request);
  const result = await api.projects.createProject({
    ...input.data,
    sourceProjectId,
    wbsTemplateKey
  });
  if (result.error?.message === COST_OBJECTIVE_REQUIRED) {
    return validationError({
      fieldErrors: { costObjective: COST_OBJECTIVE_REQUIRED }
    });
  }
  if (result.error) {
    return data(
      {},
      await flash(args.request, error(null, result.error.message))
    );
  }

  throw redirect(
    path.to.projectElements(result.data.projectId),
    await flash(args.request, success("Project created"))
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
        options: [
          ...copyFromProjects.map((project) => ({
            value: project.id,
            label: project.isTemplate
              ? t`${project.name} (template)`
              : project.identifier
                ? `${project.name} (${project.identifier})`
                : project.name
          })),
          ...WBS_TEMPLATES.map((template) => ({
            value: `${WBS_TEMPLATE_PREFIX}${template.key}`,
            label: template.name
          }))
        ]
      }}
      onClose={() => navigate(path.to.projects)}
    />
  );
}
