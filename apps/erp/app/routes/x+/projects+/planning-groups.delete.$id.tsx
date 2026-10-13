// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deletePlanningGroup, getPlanningGroup } from "~/modules/projects";
import { path } from "~/utils/path";

const logger = getLogger("erp", "planning-group-delete");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "projects"
  });

  const { id } = params;
  if (!id) throw notFound("Planning group ID was not found");

  const group = await getPlanningGroup(client, id, companyId);
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

  return { group: group.data };
}

// Deleting is not plan-gated: a company whose plan lapsed can still clean up.
export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "projects"
  });

  const { id } = params;
  if (!id) throw notFound("Planning group ID was not found");

  const deleted = await deletePlanningGroup(client, id, companyId);
  if (deleted.error) {
    logger.error("Failed to delete a planning group", {
      companyId,
      id,
      error: deleted.error
    });
    throw redirect(
      path.to.planningGroups,
      await flash(
        request,
        error(deleted.error, "Failed to delete the planning group")
      )
    );
  }

  throw redirect(
    path.to.planningGroups,
    await flash(request, success("Planning group deleted"))
  );
}

export default function DeletePlanningGroupRoute() {
  const { id } = useParams();
  const { group } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();

  if (!id) throw new Error("Planning group ID was not found");

  const name = group.name;
  return (
    <ConfirmDelete
      action={path.to.deletePlanningGroup(id)}
      name={name}
      text={t`Are you sure you want to delete the planning group: ${name}? This cannot be undone.`}
      onCancel={() => navigate(path.to.planningGroups)}
    />
  );
}
