// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { RecordOutlet } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData, useParams } from "react-router";
import { usePermissions, useRouteData } from "~/hooks";
import { deleteProjectElement } from "~/modules/projects";
import { insertProjectElement } from "~/modules/projects/projects.server";
import { BuildFromPartDrawer } from "~/modules/projects/ui/Elements/BuildFromPartDrawer";
import type { ServiceOrder } from "~/modules/service";
import {
  getServiceWork,
  serviceNodeValidator,
  summarizeWork
} from "~/modules/service";
import WorkTree from "~/modules/service/ui/Work/WorkTree";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "service-order-work");

async function getOrderProject(
  client: Awaited<ReturnType<typeof requirePermissions>>["client"],
  id: string,
  companyId: string
) {
  return client
    .from("serviceOrder")
    .select("projectId, status")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "service"
  });
  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const order = await getOrderProject(client, id, companyId);
  if (order.error) {
    throw redirect(
      path.to.serviceOrderDetails(id),
      await flash(request, error(order.error, "Failed to load the work"))
    );
  }

  const work = await getServiceWork(client, order.data.projectId, companyId);
  if (work.error) {
    logger.error("Failed to load the work tree", {
      companyId,
      serviceOrderId: id,
      error: work.error
    });
  }

  return {
    projectId: order.data.projectId,
    nodes: work.elements,
    ledger: work.ledger,
    billable: work.billable
  };
}

function failure(message: string) {
  return data({ success: false, error: { message } }, { status: 400 });
}

/** Adds a node to the work tree, or deletes one with no charges. */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "service"
  });
  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const order = await getOrderProject(client, id, companyId);
  if (order.error) return failure("The service order was not found");
  if (order.data.status === "Closed" || order.data.status === "Cancelled") {
    return failure("A closed or cancelled service order cannot change");
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "delete") {
    const elementId = formData.get("elementId");
    if (typeof elementId !== "string" || !elementId) {
      return failure("Choose a node to delete");
    }
    const node = await client
      .from("projectElement")
      .select("id")
      .eq("id", elementId)
      .eq("projectId", order.data.projectId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (!node.data) return failure("The node is not part of this order");
    const result = await deleteProjectElement(client, elementId, companyId);
    if (result.error) {
      throw redirect(
        path.to.serviceOrderWork(id),
        await flash(
          request,
          error(result.error, result.error.message ?? "Failed to delete")
        )
      );
    }
    throw redirect(
      path.to.serviceOrderWork(id),
      await flash(request, success("Node deleted"))
    );
  }

  if (intent !== "add") return failure("Unknown intent");

  const validation = await validator(serviceNodeValidator).validate(formData);
  if (validation.error) return failure("Name the node");

  try {
    const created = await insertProjectElement(getDatabaseClient(), {
      type: validation.data.type,
      name: validation.data.name,
      parentId: validation.data.parentId,
      projectId: order.data.projectId,
      companyId,
      userId
    });
    return data({ success: true, id: created.id }, { status: 201 });
  } catch (err) {
    logger.error("Failed to add a node", {
      companyId,
      serviceOrderId: id,
      error: err
    });
    return failure(
      err instanceof Error ? err.message : "Failed to add the node"
    );
  }
}

export default function ServiceOrderWorkRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");
  const { projectId, nodes, ledger, billable } = useLoaderData<typeof loader>();
  const routeData = useRouteData<{ serviceOrder: ServiceOrder }>(
    path.to.serviceOrder(id)
  );
  const permissions = usePermissions();
  const [isBuilding, setIsBuilding] = useState(false);

  const totals = useMemo(
    () => summarizeWork(nodes, ledger, billable),
    [nodes, ledger, billable]
  );

  const order = routeData?.serviceOrder;
  const isFinal = order?.status === "Closed" || order?.status === "Cancelled";
  const isDisabled = !permissions.can("update", "service") || isFinal;

  return (
    <>
      <WorkTree
        nodes={nodes}
        totals={totals}
        isDisabled={isDisabled}
        onBuildTree={() => setIsBuilding(true)}
      />
      {isBuilding && (
        <BuildFromPartDrawer
          projectId={projectId}
          elements={nodes}
          defaultParentId={null}
          endpoint={path.to.serviceOrderWorkBuild(id)}
          initial={{
            source: "Serial",
            itemId: order?.itemId ?? null,
            trackedEntityId: order?.trackedEntityId ?? null
          }}
          vocabulary="node"
          onClose={() => setIsBuilding(false)}
        />
      )}
      <RecordOutlet />
    </>
  );
}
