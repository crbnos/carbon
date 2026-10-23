// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { requireFeature } from "@carbon/ee/plan.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import { planningGroupValidator } from "~/modules/projects/projects.models";
import { getStockOwnerProjects } from "~/modules/projects/projects.service";
import PlanningGroupForm from "~/modules/projects/ui/PlanningGroups/PlanningGroupForm";
import { path } from "~/utils/path";

const logger = getLogger("erp", "planning-group-new");

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "projects"
  });

  await requireFeature({
    request,
    client,
    companyId,
    feature: "PLANNING_GROUPS",
    redirectTo: path.to.planningGroups
  });

  const stockProjects = await getStockOwnerProjects(client, companyId);
  if (stockProjects.error) {
    logger.error("Failed to load the projects with project stock", {
      companyId,
      error: stockProjects.error
    });
  }

  return { stockProjects: stockProjects.data ?? [] };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);

  const validation = await validator(planningGroupValidator).validate(
    await request.formData()
  );
  if (validation.error) return validationError(validation.error);

  const { id: _id, ...fields } = validation.data;
  const api = await carbon(request);
  const created = await api.projects.upsertPlanningGroup(fields);

  if (created.error?.category === "entitlement") {
    throw redirect(
      path.to.planningGroups,
      await flash(request, error(null, created.error.message))
    );
  }
  if (created.error) {
    return data(
      {},
      await flash(
        request,
        error(created.error, "Failed to create the planning group")
      )
    );
  }

  throw redirect(
    path.to.planningGroups,
    await flash(request, success("Planning group created"))
  );
}

export default function NewPlanningGroupRoute() {
  const { stockProjects } = useLoaderData<typeof loader>();
  const closeRoute = useCloseRoute();
  return (
    <PlanningGroupForm
      initialValues={{
        name: "",
        locationId: "",
        excessRule: "Common Stock",
        priorityRule: "Earliest Need",
        active: true
      }}
      stockProjects={stockProjects}
      onClose={() => closeRoute()}
    />
  );
}
