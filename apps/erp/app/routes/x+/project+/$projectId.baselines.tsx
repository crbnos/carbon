// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import {
  type ActionFunctionArgs,
  data,
  type LoaderFunctionArgs,
  useLoaderData,
  useOutlet,
  useParams
} from "react-router";
import { projectBaselineValidator } from "~/modules/projects/projects.models";
import { getProjectBaselines } from "~/modules/projects/projects.service";
import BaselinesList from "~/modules/projects/ui/Baselines/BaselinesList";
import { path } from "~/utils/path";

const logger = getLogger("erp", "project-baselines");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "projects"
  });

  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const baselines = await getProjectBaselines(client, projectId, companyId);
  if (baselines.error) {
    logger.error("Failed to load baselines", {
      companyId,
      projectId,
      error: baselines.error
    });
  }

  return { baselines: baselines.data ?? [] };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const formData = await request.formData();
  if (formData.get("intent") !== "create") {
    return data(
      { success: false },
      await flash(request, error(null, "Unknown action"))
    );
  }

  const validation = await validator(projectBaselineValidator).validate(
    formData
  );
  if (validation.error) return validationError(validation.error);

  const api = await carbon(request);
  const result = await api.projects.createProjectBaseline({
    ...validation.data,
    projectId
  });
  if (result.error) {
    return data(
      { success: false },
      await flash(request, error(null, result.error.message))
    );
  }

  return data(
    { success: true },
    await flash(request, success("Baseline taken"))
  );
}

export default function ProjectBaselinesRoute() {
  const { projectId } = useParams();
  if (!projectId) throw new Error("Could not find projectId");

  const { baselines } = useLoaderData<typeof loader>();
  // The compare page is a child route: it replaces the list.
  const outlet = useOutlet();
  if (outlet) return outlet;

  return (
    <BaselinesList
      projectId={projectId}
      baselines={baselines}
      action={path.to.projectBaselines(projectId)}
    />
  );
}
