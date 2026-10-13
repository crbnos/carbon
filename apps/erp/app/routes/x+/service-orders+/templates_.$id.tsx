// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { useMemo } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import { RecordHeader } from "~/components/Layout/RecordHeader";
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
    (data) => data?.template?.identifier ?? data?.template?.name
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
      return failure("Choose an element to delete");
    }
    const node = await client
      .from("projectElement")
      .select("id")
      .eq("id", elementId)
      .eq("projectId", id)
      .eq("companyId", companyId)
      .maybeSingle();
    if (!node.data) return failure("The element is not part of this template");
    const result = await deleteProjectElement(client, elementId, companyId);
    if (result.error) {
      throw redirect(
        path.to.serviceTemplate(id),
        await flash(
          request,
          error(result.error, "Failed to delete the element")
        )
      );
    }
    throw redirect(
      path.to.serviceTemplate(id),
      await flash(request, success("Element deleted"))
    );
  }

  if (intent !== "add") return failure("Unknown intent");
  const validation = await validator(serviceNodeValidator).validate(formData);
  if (validation.error) return failure("Name the element");

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
      err instanceof Error ? err.message : "Failed to add the element"
    );
  }
}

export default function ServiceTemplateRoute() {
  const { template, nodes, plan } = useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const planTotals = useMemo(() => new Map(Object.entries(plan)), [plan]);
  const totals = useMemo(() => new Map(), []);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <RecordHeader
        title={
          <span className="flex min-w-0 items-center gap-2">
            {template.identifier && (
              <span className="shrink-0 whitespace-nowrap">
                {template.identifier}
              </span>
            )}
            <span
              className={
                template.identifier
                  ? "min-w-0 truncate font-normal text-muted-foreground"
                  : "min-w-0 truncate"
              }
            >
              {template.name}
            </span>
          </span>
        }
        copyValue={template.identifier ?? undefined}
        toolsPlacement="end"
      />
      <div className="min-h-0 flex-1 overflow-y-auto bg-card">
        <div className="flex w-full flex-col gap-4 p-4">
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
      </div>
    </div>
  );
}
