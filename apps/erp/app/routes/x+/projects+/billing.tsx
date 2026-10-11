// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  getContractBillableItems,
  getContractBillingLines
} from "~/modules/projects";
import ProjectBillableItemsTable from "~/modules/projects/ui/Billing/ProjectBillableItemsTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

const logger = getLogger("erp", "projects-billing");

export const handle: Handle = {
  breadcrumb: msg`Billing`,
  to: path.to.projectsBilling,
  module: "projects"
};

/** Contract billable items to review, across every project. With no status
 *  filter it lists Unbilled and On Hold items. */
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "projects"
  });

  const searchParams = new URL(request.url).searchParams;
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);
  const hasStatusFilter = (filters ?? []).some(
    (filter) => filter.column === "status"
  );

  const [items, lines] = await Promise.all([
    getContractBillableItems(client, {
      companyId,
      status: hasStatusFilter ? null : ["Unbilled", "On Hold"],
      limit,
      offset,
      sorts,
      filters
    }),
    getContractBillingLines(client, { companyId })
  ]);
  if (items.error) {
    logger.error("Failed to load billable items", {
      companyId,
      error: items.error
    });
    throw redirect(
      path.to.projects,
      await flash(request, error(items.error, "Failed to load billable items"))
    );
  }
  if (lines.error) {
    logger.error("Failed to load contract billing lines", {
      companyId,
      error: lines.error
    });
  }

  return {
    items: items.data ?? [],
    count: items.count ?? 0,
    lines: lines.data ?? []
  };
}

export default function ProjectsBillingRoute() {
  const { t } = useLingui();
  const { items, count, lines } = useLoaderData<typeof loader>();
  const projects = new Map<string, string>();
  for (const item of items) {
    if (item.project)
      projects.set(
        item.project.id,
        item.project.identifier ?? item.project.name
      );
  }

  return (
    <VStack spacing={0} className="h-full">
      <ProjectBillableItemsTable
        data={items}
        count={count}
        title={t`Billing`}
        projects={[...projects].map(([value, label]) => ({ value, label }))}
        lines={lines.map((line) => ({
          value: line.id,
          label: `${line.contract?.customerContractId ?? ""} · ${
            line.description || line.item?.name || line.id
          }`
        }))}
      />
    </VStack>
  );
}
