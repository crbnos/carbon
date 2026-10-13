// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { EntitlementError } from "@carbon/ee/entitlements.server";
import { upsertPlanningGroup } from "@carbon/ee/pegging.server";
import { requireFeature } from "@carbon/ee/plan.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import {
  getPlanningGroup,
  getPlanningGroupMembers,
  getStockOwnerProjects,
  planningGroupValidator
} from "~/modules/projects";
import PlanningGroupForm from "~/modules/projects/ui/PlanningGroups/PlanningGroupForm";
import { path } from "~/utils/path";

const logger = getLogger("erp", "planning-group");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "projects",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw notFound("Planning group ID was not found");

  const [group, members, stockProjects] = await Promise.all([
    getPlanningGroup(client, id, companyId),
    getPlanningGroupMembers(client, id, companyId),
    getStockOwnerProjects(client, companyId)
  ]);

  if (group.error) {
    logger.error("Failed to load a planning group", {
      companyId,
      id,
      error: group.error
    });
    throw redirect(
      path.to.planningGroups,
      await flash(
        request,
        error(group.error, "Failed to load the planning group")
      )
    );
  }
  if (members.error) {
    logger.error("Failed to load the members of a planning group", {
      companyId,
      id,
      error: members.error
    });
  }
  if (stockProjects.error) {
    logger.error("Failed to load the projects with project stock", {
      companyId,
      error: stockProjects.error
    });
  }

  return {
    group: group.data,
    members: members.data ?? [],
    stockProjects: stockProjects.data ?? []
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "projects"
  });

  const { id } = params;
  if (!id) throw notFound("Planning group ID was not found");

  await requireFeature({
    request,
    client,
    companyId,
    feature: "PLANNING_GROUPS",
    redirectTo: path.to.planningGroups
  });

  const validation = await validator(planningGroupValidator).validate(
    await request.formData()
  );
  if (validation.error) return validationError(validation.error);

  const { id: _id, ...fields } = validation.data;
  let updated: Awaited<ReturnType<typeof upsertPlanningGroup>>;
  try {
    updated = await upsertPlanningGroup(client, {
      ...fields,
      id,
      companyId,
      updatedBy: userId
    });
  } catch (err) {
    if (!(err instanceof EntitlementError)) throw err;
    logger.error("Planning groups are not in the company's plan", {
      companyId
    });
    throw redirect(
      path.to.planningGroups,
      await flash(request, error(err, "Upgrade to use planning groups"))
    );
  }

  if (updated.error) {
    logger.error("Failed to update a planning group", {
      companyId,
      id,
      error: updated.error
    });
    return data(
      {},
      await flash(
        request,
        error(updated.error, "Failed to update the planning group")
      )
    );
  }

  throw redirect(
    path.to.planningGroups,
    await flash(request, success("Planning group updated"))
  );
}

export default function PlanningGroupRoute() {
  const { group, members, stockProjects } = useLoaderData<typeof loader>();
  const closeRoute = useCloseRoute();

  return (
    <PlanningGroupForm
      key={group.id}
      initialValues={{
        id: group.id,
        name: group.name,
        locationId: group.locationId,
        excessRule: group.excessRule,
        exceptionProjectId: group.exceptionProjectId ?? undefined,
        priorityRule: group.priorityRule,
        active: group.active
      }}
      stockProjects={stockProjects}
      members={members}
      onClose={() => closeRoute()}
    />
  );
}
