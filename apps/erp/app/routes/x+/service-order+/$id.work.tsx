// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton
} from "@carbon/react";
import { redirect } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuEllipsisVertical, LuPrinter } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { usePermissions } from "~/hooks";
import { parseElementFilters } from "~/modules/projects/projects.models";
import {
  getProjectElements,
  getProjectLabels,
  getProjectStates
} from "~/modules/projects/projects.service";
import { ServiceWorkList } from "~/modules/service/ui/Work/ServiceWorkList";
import { path } from "~/utils/path";

const logger = getLogger("erp", "service-order-work");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "service"
  });
  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const order = await client
    .from("serviceOrder")
    .select("projectId, status, itemId, trackedEntityId")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
  if (order.error) {
    throw redirect(
      path.to.serviceOrderDetails(id),
      await flash(request, error(order.error, "Failed to load the work"))
    );
  }

  const { filters, isFiltered } = parseElementFilters(
    new URL(request.url).searchParams
  );
  const [elements, states, labels] = await Promise.all([
    getProjectElements(client, order.data.projectId, companyId, filters),
    getProjectStates(client, companyId),
    getProjectLabels(client, companyId)
  ]);
  if (elements.error || states.error || labels.error) {
    logger.error("Failed to load the work", {
      companyId,
      serviceOrderId: id,
      error: elements.error ?? states.error ?? labels.error
    });
  }

  return {
    order: order.data,
    elements: elements.data ?? [],
    states: states.data ?? [],
    labels: labels.data ?? [],
    isFiltered
  };
}

/**
 * The order's work as the project Plan page's List. An element opens on its
 * own page (`$id_.work.$elementId`); every write posts to the service work
 * routes (`x+/service-work+`).
 */
export default function ServiceOrderWorkRoute() {
  const { t } = useLingui();
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");
  const { order, elements, states, labels, isFiltered } =
    useLoaderData<typeof loader>();
  const permissions = usePermissions();

  const isFinal = order.status === "Closed" || order.status === "Cancelled";
  return (
    // The workspace (`$id.tsx`) provides the work's element routes.
    <ServiceWorkList
      projectId={order.projectId}
      elements={elements}
      states={states}
      labels={labels}
      isFiltered={isFiltered}
      isDisabled={!permissions.can("update", "service") || isFinal}
      buildEndpoint={path.to.serviceOrderWorkBuild(id)}
      buildInitial={{
        source: "Serial",
        itemId: order.itemId,
        trackedEntityId: order.trackedEntityId
      }}
      menu={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              aria-label={t`More options`}
              icon={<LuEllipsisVertical />}
              variant="secondary"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <a
                href={path.to.serviceOrderEstimate(id)}
                target="_blank"
                rel="noreferrer"
              >
                <DropdownMenuIcon icon={<LuPrinter />} />
                <Trans>Print estimate</Trans>
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    />
  );
}
