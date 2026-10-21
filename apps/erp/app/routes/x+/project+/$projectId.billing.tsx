// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { Button, LabelWithHelp } from "@carbon/react";
import { datetime } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuCirclePlus } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useParams } from "react-router";
import Empty from "~/components/Empty";
import { usePermissions, useRouteData } from "~/hooks";
import {
  getContractBillableItems,
  getContractBillingLines,
  getProjectContractRevenue
} from "~/modules/projects";
import ProjectBillableItemsTable from "~/modules/projects/ui/Billing/ProjectBillableItemsTable";
import ProjectBillingLines from "~/modules/projects/ui/Billing/ProjectBillingLines";
import { getContractLineFunding } from "~/modules/sales";
import type { ContractStatusType } from "~/modules/sales/ui/Contracts";
import { ContractStatus } from "~/modules/sales/ui/Contracts";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

const logger = getLogger("erp", "project-billing");

/** A project's contract billing: the lines that bill it with their funding,
 *  and its billable items. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  // Contract billing: the sales permission as well as the projects one.
  const { client, companyId } = await requirePermissions(request, {
    view: ["projects", "sales"]
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

/** What `$projectId.tsx` loads about the project contracts that bill it. */
type ProjectContractRef = {
  id: string;
  customerContractId: string;
  name: string;
  status: ContractStatusType;
};

export default function ProjectBillingRoute() {
  const { t } = useLingui();
  const { projectId } = useParams();
  if (!projectId) throw new Error("projectId not found");
  const { lines, items, count, funding, revenue } =
    useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const routeData = useRouteData<{ projectContracts: ProjectContractRef[] }>(
    path.to.project(projectId)
  );
  const projectContracts = routeData?.projectContracts ?? [];

  // No project contract: nothing bills the project yet.
  if (projectContracts.length === 0) {
    return (
      <Empty
        title={t`No project contract bills this project`}
        description={t`A project contract sets how this project bills: Time & Materials, Cost Plus or Fixed Price.`}
      >
        {permissions.can("create", "sales") && (
          <Button asChild leftIcon={<LuCirclePlus />} className="mt-4">
            <Link to={path.to.newProjectContractForProject(projectId)}>
              <Trans>New Project Contract</Trans>
            </Link>
          </Button>
        )}
      </Empty>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <section className="flex max-h-80 shrink-0 flex-col gap-2 border-b border-border p-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-1">
          {projectContracts.map((contract) => (
            <span
              key={contract.id}
              className="flex min-w-0 items-center gap-2 text-sm"
            >
              <Link
                to={path.to.contract(contract.id)}
                className="flex min-w-0 items-center gap-2 hover:underline"
              >
                <span className="shrink-0 whitespace-nowrap font-medium">
                  {contract.customerContractId}
                </span>
                <span className="min-w-0 truncate">{contract.name}</span>
              </Link>
              <span className="shrink-0">
                <ContractStatus status={contract.status} />
              </span>
            </span>
          ))}
        </div>
        <ProjectBillingLines
          lines={lines}
          funding={funding}
          revenue={revenue}
        />
      </section>
      <div className="flex h-12 shrink-0 items-center px-4">
        <h3 className="text-sm font-medium">
          <LabelWithHelp termId="billable-item" variant="inline">
            <Trans>Billable items</Trans>
          </LabelWithHelp>
        </h3>
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
