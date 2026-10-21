// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { EntitlementError } from "@carbon/ee/entitlements.server";
import { createManualPeg } from "@carbon/ee/pegging.server";
import { requireFeature } from "@carbon/ee/plan.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData, useNavigate, useParams } from "react-router";
import {
  manualPegValidator,
  parseManualPegSupply
} from "~/modules/projects/projects.models";
import { getPlanningGroupOpenSupplies } from "~/modules/projects/projects.service";
import ManualPegForm from "~/modules/projects/ui/Pegging/ManualPegForm";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "project-pegging-manual");

/**
 * The Soft peg to override (`?pegId=`) and the open orders of its planning
 * group for the same item: the supplies a Manual peg may name.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "projects"
  });

  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  await requireFeature({
    request,
    client,
    companyId,
    feature: "PLANNING_GROUPS",
    redirectTo: path.to.projectPegging(projectId)
  });

  const pegId = new URL(request.url).searchParams.get("pegId");
  if (!pegId) throw redirect(path.to.projectPegging(projectId));

  const peg = await client
    .from("projectPeg")
    .select(
      "id, planningGroupId, itemId, supplyType, supplyId, quantity, needDate, state, item:item!projectPeg_itemId_fkey(readableIdWithRevision, name)"
    )
    .eq("id", pegId)
    .eq("companyId", companyId)
    .eq("projectId", projectId)
    .is("supersededAt", null)
    .maybeSingle();

  if (peg.error || !peg.data || peg.data.state !== "Soft") {
    if (peg.error) {
      logger.error("Failed to load the peg", {
        companyId,
        projectId,
        pegId,
        error: peg.error
      });
    }
    throw redirect(
      path.to.projectPegging(projectId),
      await flash(
        request,
        error(peg.error, "The peg has changed. Reload the page.")
      )
    );
  }

  const supplies = await getPlanningGroupOpenSupplies(client, {
    companyId,
    planningGroupId: peg.data.planningGroupId,
    itemIds: [peg.data.itemId]
  });
  if (supplies.error) {
    logger.error("Failed to load the planning group's open supply", {
      companyId,
      projectId,
      error: supplies.error
    });
  }

  return {
    peg: {
      ...peg.data,
      item: peg.data.item as {
        readableIdWithRevision: string | null;
        name: string;
      } | null
    },
    supplies: supplies.data
  };
}

/**
 * Replaces one Soft peg with a Manual peg. `createManualPeg` writes past
 * row-level security, so this action checks `update: projects` first; the
 * entitlement lock is inside the ee function.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "projects"
  });

  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  await requireFeature({
    request,
    client,
    companyId,
    feature: "PLANNING_GROUPS",
    redirectTo: path.to.projectPegging(projectId)
  });

  const validation = await validator(manualPegValidator).validate(
    await request.formData()
  );
  if (validation.error) return validationError(validation.error);

  const supply = parseManualPegSupply(validation.data.supply);
  if (!supply) {
    return validationError({
      fieldErrors: { supply: "Supply is required" }
    });
  }

  let result: Awaited<ReturnType<typeof createManualPeg>>;
  try {
    result = await createManualPeg(client, getDatabaseClient(), {
      companyId,
      userId,
      projectId,
      pegId: validation.data.pegId,
      supplyType: supply.supplyType,
      supplyId: supply.supplyId,
      quantity: validation.data.quantity,
      manualReason: validation.data.manualReason
    });
  } catch (err) {
    if (!(err instanceof EntitlementError)) throw err;
    throw redirect(
      path.to.projectPegging(projectId),
      await flash(request, error(err, "Upgrade to use planning groups"))
    );
  }

  if (result.error) {
    logger.error("Failed to create a manual peg", {
      companyId,
      projectId,
      error: result.error
    });
    return data({}, await flash(request, error(result.error, result.error)));
  }

  throw redirect(
    path.to.projectPegging(projectId),
    await flash(request, success("Manual peg created"))
  );
}

export default function ProjectPeggingManualRoute() {
  const { peg, supplies } = useLoaderData<typeof loader>();
  const { projectId } = useParams();
  if (!projectId) throw new Error("Could not find projectId");
  const navigate = useNavigate();

  return (
    <ManualPegForm
      peg={peg}
      supplies={supplies}
      onClose={() => navigate(path.to.projectPegging(projectId))}
    />
  );
}
