// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { LabelWithHelp, Subheading } from "@carbon/react";
import { datetime } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import Empty from "~/components/Empty";
import {
  getContractBillableItems,
  getContractBillingLines,
  getProjectContractRevenue
} from "~/modules/projects";
import ProjectBillableItemsTable from "~/modules/projects/ui/Billing/ProjectBillableItemsTable";
import ProjectBillingLines from "~/modules/projects/ui/Billing/ProjectBillingLines";
import { getContractLineFunding } from "~/modules/sales";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { getGenericQueryFilters } from "~/utils/query";

const logger = getLogger("erp", "project-billing");

/** A project's contract billing: the lines that bill it with their funding,
 *  and its billable items. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "projects"
  });

  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const searchParams = new URL(request.url).searchParams;
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [lines, items, timeZone] = await Promise.all([
    getContractBillingLines(client, { companyId, projectId }),
    getContractBillableItems(client, {
      companyId,
      projectId,
      limit,
      offset,
      sorts,
      filters
    }),
    getCompanyTimeZone(client, companyId)
  ]);
  const lineIds = (lines.data ?? []).map((line) => line.id);
  const [funding, revenue] = await Promise.all([
    getContractLineFunding(client, {
      companyId,
      lineIds,
      asOf: datetime.today(timeZone).toString()
    }),
    getProjectContractRevenue(client, { companyId, lineIds })
  ]);
  if (lines.error || items.error || funding.error || revenue.error) {
    logger.error("Failed to load a project's billing", {
      companyId,
      projectId,
      error: lines.error ?? items.error ?? funding.error ?? revenue.error
    });
  }

  return {
    lines: lines.data ?? [],
    items: items.data ?? [],
    count: items.count ?? 0,
    revenue: revenue.data ?? {},
    funding: Object.fromEntries(
      (funding.data ?? []).map((row) => [
        row.customerContractLineId,
        {
          billed: Number(row.billed),
          unbilled: Number(row.unbilled),
          incurred: Number(row.incurred)
        }
      ])
    )
  };
}

export default function ProjectBillingRoute() {
  const { t } = useLingui();
  const { lines, items, count, funding, revenue } =
    useLoaderData<typeof loader>();

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <section className="flex max-h-80 shrink-0 flex-col gap-1 border-b border-border p-4">
        <Subheading as="h3" variant="light">
          <Trans>Contract lines</Trans>
        </Subheading>
        <ProjectBillingLines
          lines={lines}
          funding={funding}
          revenue={revenue}
        />
      </section>
      <div className="flex h-12 shrink-0 items-center px-4">
        <Subheading as="h3" variant="light">
          <LabelWithHelp termId="billable-item" variant="inline">
            <Trans>Billable items</Trans>
          </LabelWithHelp>
        </Subheading>
      </div>
      <div className="min-h-0 flex-1">
        <ProjectBillableItemsTable
          data={items}
          count={count}
          emptyState={
            <Empty title={t`No billable items yet`} description={null} />
          }
          lines={lines.map((line) => ({
            value: line.id,
            label: `${line.contract?.customerContractId ?? ""} · ${
              line.description || line.item?.name || line.id
            }`
          }))}
        />
      </div>
    </div>
  );
}
