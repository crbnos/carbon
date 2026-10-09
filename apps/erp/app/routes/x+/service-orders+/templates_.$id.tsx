// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { Button, Heading, RecordOutlet } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMemo } from "react";
import { LuChevronLeft } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Link, useLoaderData } from "react-router";
import { usePermissions } from "~/hooks";
import { deleteProjectElement } from "~/modules/projects";
import { insertProjectElement } from "~/modules/projects/projects.server";
import {
  buildServiceEstimate,
  getServiceEstimateInputs,
  getServiceTemplate,
  getServiceWorkNodes,
  serviceNodeValidator
} from "~/modules/service";
import WorkTree from "~/modules/service/ui/Work/WorkTree";
import { getDatabaseClient } from "~/services/database.server";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "service-template");

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Service Templates`, to: path.to.serviceTemplates },
    (data) => data?.template?.name
  )
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "service"
  });
  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const template = await getServiceTemplate(client, id, companyId);
  if (template.error) {
    throw redirect(
      path.to.serviceTemplates,
      await flash(
        request,
        error(template.error, "Failed to load the service template")
      )
    );
  }

  const [nodes, inputs] = await Promise.all([
    getServiceWorkNodes(client, id, companyId),
    getServiceEstimateInputs(client, id, companyId)
  ]);
  if (nodes.error || inputs.error) {
    logger.error("Failed to load the work of a service template", {
      companyId,
      templateId: id,
      error: nodes.error ?? inputs.error
    });
  }

  // Each node's plan at sale prices, and its planned hours.
  const plan: Record<string, { hours: number; estimate: number }> = {};
  if (inputs.data) {
    const estimate = buildServiceEstimate({ ...inputs.data, laborUnit: "HR" });
    for (const node of estimate.nodes) {
      plan[node.id] = { hours: 0, estimate: node.total };
    }
    for (const line of inputs.data.labor) {
      const current = plan[line.projectElementId];
      if (current) current.hours += line.hours;
    }
  }

  return { template: template.data, nodes: nodes.data ?? [], plan };
}

function failure(message: string) {
  return data({ success: false, error: { message } }, { status: 400 });
}

/** Adds a node to the template's work, or deletes one. */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "service"
  });
  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const template = await getServiceTemplate(client, id, companyId);
  if (template.error) return failure("The service template was not found");

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
      .eq("projectId", id)
      .eq("companyId", companyId)
      .maybeSingle();
    if (!node.data) return failure("The node is not part of this template");
    const result = await deleteProjectElement(client, elementId, companyId);
    if (result.error) {
      throw redirect(
        path.to.serviceTemplate(id),
        await flash(request, error(result.error, "Failed to delete the node"))
      );
    }
    throw redirect(
      path.to.serviceTemplate(id),
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
      projectId: id,
      companyId,
      userId
    });
    return data({ success: true, id: created.id }, { status: 201 });
  } catch (err) {
    logger.error("Failed to add a template node", {
      companyId,
      templateId: id,
      error: err
    });
    return failure(
      err instanceof Error ? err.message : "Failed to add the node"
    );
  }
}

export default function ServiceTemplateRoute() {
  const { template, nodes, plan } = useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const planTotals = useMemo(() => new Map(Object.entries(plan)), [plan]);
  const totals = useMemo(() => new Map(), []);

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto">
      <div className="flex w-full flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            leftIcon={<LuChevronLeft />}
            className="-ml-2"
            asChild
          >
            <Link to={path.to.serviceTemplates}>
              <Trans>Service Templates</Trans>
            </Link>
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Heading size="h3">{template.name}</Heading>
          {template.identifier && (
            <span className="whitespace-nowrap font-mono text-sm text-muted-foreground">
              {template.identifier}
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          <Trans>
            A service order started from this template copies its nodes and
            their plan lines. Open a node to plan its materials, labor and other
            costs; the estimate prices them at sale prices.
          </Trans>
        </p>
        <WorkTree
          nodes={nodes}
          totals={totals}
          isDisabled={!permissions.can("update", "service")}
          action={path.to.serviceTemplate(template.id)}
          nodeHref={(nodeId) =>
            path.to.serviceTemplateNode(template.id, nodeId)
          }
          planTotals={planTotals}
        />
      </div>
      <RecordOutlet />
    </div>
  );
}
