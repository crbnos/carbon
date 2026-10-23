// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import {
  type ActionFunctionArgs,
  data,
  type LoaderFunctionArgs,
  useLoaderData,
  useParams
} from "react-router";
import { DateTime } from "~/components";
import { usePermissions } from "~/hooks";
import {
  getProject,
  getProjectElementPage,
  getProjectLabels,
  getProjectStates
} from "~/modules/projects/projects.service";
import { ElementView } from "~/modules/projects/ui/Element/ElementView";
import { PropertyField } from "~/modules/projects/ui/Element/PropertyFields";
import { ElementRoutesProvider } from "~/modules/projects/ui/Elements/ElementRoutes";
import { serviceNodeFixedPriceValidator } from "~/modules/service/service.models";
import { getServiceNode } from "~/modules/service/service.service";
import {
  FixedPriceField,
  ServiceCharges,
  useServiceChargeActions
} from "~/modules/service/ui/Work/ServiceCharges";
import { serviceOrderElementRoutes } from "~/modules/service/ui/Work/serviceElementRoutes";
import { getRecordIssueLinks } from "~/modules/shared/shared.service";
import { getDatabaseClient } from "~/services/database.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "service-order-element");

export const handle: Handle = {
  breadcrumb: (
    params: { id?: string },
    data:
      | {
          serviceOrder?: { serviceOrderId: string };
          element?: { readableId: string };
        }
      | undefined
  ) => [
    { breadcrumb: msg`Service Orders`, to: path.to.serviceOrders },
    ...(data?.serviceOrder && params.id
      ? [
          {
            breadcrumb: data.serviceOrder.serviceOrderId,
            to: path.to.serviceOrderWork(params.id)
          }
        ]
      : []),
    ...(data?.element ? [{ breadcrumb: data.element.readableId }] : [])
  ],
  module: "service"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "service"
  });
  const { id, elementId } = params;
  if (!id) throw new Error("Could not find id");
  if (!elementId) throw new Error("Could not find elementId");

  const order = await client
    .from("serviceOrder")
    .select("id, serviceOrderId, projectId, status")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
  if (order.error) {
    throw redirect(
      path.to.serviceOrders,
      await flash(request, error(order.error, "Failed to load the element"))
    );
  }
  const { projectId } = order.data;

  const [page, node, project, states, labels, issueLinks] = await Promise.all([
    getProjectElementPage(client, getDatabaseClient(), {
      companyId,
      projectId,
      elementId,
      userId
    }),
    getServiceNode(client, { projectId, elementId, companyId }),
    getProject(client, companyId, projectId),
    getProjectStates(client, companyId),
    getProjectLabels(client, companyId),
    // The task's Linear and Jira links (issue-sync), for the issue dialogs.
    getRecordIssueLinks(client, "projectElement", elementId, companyId)
  ]);
  if (page.error || !page.data || node.error || !node.data || project.error) {
    logger.error("Failed to load a service element", {
      companyId,
      serviceOrderId: id,
      elementId,
      error: page.error ?? node.error ?? project.error
    });
    throw redirect(
      path.to.serviceOrderWork(id),
      await flash(
        request,
        error(page.error ?? node.error, "Failed to load the element")
      )
    );
  }

  return {
    ...page.data,
    ...issueLinks,
    project: project.data,
    states: states.data ?? [],
    labels: labels.data ?? [],
    serviceOrder: order.data,
    charges: node.data.charges,
    fixedPrice: node.data.element.fixedPrice,
    lastServiceDate: node.data.lastServiceDate
  };
}

function failure(message: string) {
  return data({ success: false, error: { message } }, { status: 400 });
}

/**
 * Sets or removes the element's fixed price (`intent=fixedPrice`) while the
 * order is not Closed or Cancelled. The sidebar field saves it quietly.
 */
export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, {
    params: ["id", "elementId"]
  });
  if ("invalid" in input) return input.invalid;
  const formData = await args.request.formData();
  if (formData.get("intent") !== "fixedPrice") return failure("Unknown intent");
  const validation = await validator(serviceNodeFixedPriceValidator).validate(
    formData
  );
  if (validation.error) return failure("Enter a price of 0 or more");

  const api = await carbon(args.request);
  const result = await api.service.updateServiceNodeFixedPrice({
    serviceOrderId: input.params.id,
    elementId: input.params.elementId,
    fixedPrice: validation.data.fixedPrice
  });
  if (result.error) return failure(result.error.message);
  return data({ success: true, error: null });
}

/**
 * A service order's element as a full page: the project element page, with
 * the order's charges in place of Time & materials, its charge actions in
 * the ⋯ menu and its fixed price in the sidebar.
 */
export default function ServiceOrderElementRoute() {
  const { t } = useLingui();
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");
  const {
    project,
    states,
    labels,
    serviceOrder,
    charges,
    fixedPrice,
    lastServiceDate,
    ...page
  } = useLoaderData<typeof loader>();
  const permissions = usePermissions();

  const isOpen =
    serviceOrder.status !== "Closed" && serviceOrder.status !== "Cancelled";
  const canCharge = permissions.can("update", "service") && isOpen;
  const chargeAction = path.to.serviceOrderCharge(id);
  const routes = useMemo(
    () => serviceOrderElementRoutes(id, serviceOrder.projectId),
    [id, serviceOrder.projectId]
  );
  const chargeActions = useServiceChargeActions({
    projectId: serviceOrder.projectId,
    element: page.element,
    chargeAction,
    laborCategories: page.laborCategories,
    defaultLaborCategoryId: page.defaultLaborCategoryId,
    canCharge,
    canIssue: permissions.can("update", "inventory")
  });

  return (
    <ElementRoutesProvider routes={routes}>
      <div className="flex h-[calc(100dvh-var(--topbar-height)-var(--content-inset))] w-full flex-col">
        <ElementView
          key={page.element.id}
          {...page}
          projectId={serviceOrder.projectId}
          project={project}
          states={states}
          labels={labels}
          milestones={[]}
          chargeActions={chargeActions.menuItems}
          charges={
            charges.length > 0 ? (
              <ServiceCharges
                charges={charges}
                chargeAction={chargeAction}
                canCharge={canCharge}
              />
            ) : null
          }
          workFields={
            <>
              <FixedPriceField
                action={path.to.serviceOrderWorkNode(id, page.element.id)}
                fixedPrice={fixedPrice === null ? null : Number(fixedPrice)}
                isDisabled={!canCharge}
              />
              {(page.element.itemId || page.element.trackedEntityId) && (
                <PropertyField label={t`Last service`}>
                  {lastServiceDate ? (
                    <DateTime value={lastServiceDate} variant="date" />
                  ) : (
                    <span className="text-muted-foreground">{t`Never`}</span>
                  )}
                </PropertyField>
              )}
            </>
          }
        />
      </div>
      {chargeActions.dialogs}
    </ElementRoutesProvider>
  );
}
