// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { Table as TableBase, Tbody, Td, Th, Thead, Tr } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { EmployeeAvatar } from "~/components";
import { useDateFormatter, useQuantityFormatter } from "~/hooks";
import {
  getProjectElementCosts,
  getProjectLedger,
  getProjectOpenTimesheetEntries
} from "~/modules/projects";
import ProjectLedgerTable from "~/modules/projects/ui/Costs/ProjectLedgerTable";
import { TimesheetEntryStatus } from "~/modules/projects/ui/Element/TimesheetEntryStatus";
import { getGenericQueryFilters } from "~/utils/query";

const logger = getLogger("erp", "project-time");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "projects"
  });

  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const searchParams = new URL(request.url).searchParams;
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [ledger, openTime, elements] = await Promise.all([
    getProjectLedger(client, companyId, {
      projectId,
      limit,
      offset,
      sorts,
      filters
    }),
    getProjectOpenTimesheetEntries(client, projectId, companyId),
    getProjectElementCosts(client, projectId, companyId)
  ]);

  if (ledger.error) {
    logger.error("Failed to load the project ledger", {
      companyId,
      projectId,
      error: ledger.error
    });
  }
  if (openTime.error) {
    logger.error("Failed to load open timesheet entries", {
      companyId,
      projectId,
      error: openTime.error
    });
  }
  if (elements.error) {
    logger.error("Failed to load project elements", {
      companyId,
      projectId,
      error: elements.error
    });
  }

  return {
    ledger: ledger.data ?? [],
    count: ledger.count ?? 0,
    openTime: openTime.data ?? [],
    elements: Object.fromEntries(
      (elements.data ?? []).map((row) => [
        row.id,
        { readableId: row.readableId, name: row.name }
      ])
    )
  };
}

export default function ProjectTimeRoute() {
  const { t } = useLingui();
  const { ledger, count, openTime, elements } = useLoaderData<typeof loader>();
  const { formatDate } = useDateFormatter();
  const formatQuantity = useQuantityFormatter();

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <section className="flex max-h-72 shrink-0 flex-col gap-1 border-b border-border p-4">
        <h3 className="text-xs font-medium text-muted-foreground">
          <Trans>Time not posted yet</Trans>
        </h3>
        {openTime.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
            <Trans>No open time</Trans>
          </p>
        ) : (
          <div className="min-h-0 overflow-auto rounded-md border border-border">
            <TableBase full>
              <Thead>
                <Tr>
                  <Th>
                    <Trans>Date</Trans>
                  </Th>
                  <Th>
                    <Trans>Employee</Trans>
                  </Th>
                  <Th>
                    <Trans>Element</Trans>
                  </Th>
                  <Th>
                    <Trans>Labor Category</Trans>
                  </Th>
                  <Th>
                    <Trans>Hours</Trans>
                  </Th>
                  <Th>
                    <Trans>Status</Trans>
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {openTime.map((entry) => (
                  <Tr key={entry.id}>
                    <Td className="whitespace-nowrap tabular-nums">
                      {formatDate(entry.entryDate)}
                    </Td>
                    <Td>
                      <EmployeeAvatar
                        employeeId={entry.employeeId}
                        size="xxs"
                      />
                    </Td>
                    <Td>
                      {entry.element ? (
                        <div className="flex max-w-[260px] items-center gap-2">
                          <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                            {entry.element.readableId}
                          </span>
                          <span className="truncate">{entry.element.name}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap">
                      {entry.laborCategory?.name ?? "—"}
                    </Td>
                    <Td className="tabular-nums">
                      {formatQuantity(entry.hours)}
                    </Td>
                    <Td>
                      <TimesheetEntryStatus status={entry.status} />
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </TableBase>
          </div>
        )}
      </section>
      <div className="flex min-h-0 flex-1 flex-col">
        <ProjectLedgerTable
          data={ledger}
          count={count}
          elements={elements}
          title={t`Costs posted`}
        />
      </div>
    </div>
  );
}
