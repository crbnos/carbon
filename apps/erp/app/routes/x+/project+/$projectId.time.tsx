// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { LabelWithHelp } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { EmployeeAvatar, Table } from "~/components";
import { useDateFormatter, useQuantityFormatter } from "~/hooks";
import {
  getProjectElementCosts,
  getProjectLedger,
  getProjectOpenTimesheetEntries
} from "~/modules/projects/projects.service";
import ProjectLedgerTable from "~/modules/projects/ui/Costs/ProjectLedgerTable";
import { OpenTimeAction } from "~/modules/projects/ui/Element/OpenTimeAction";
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

/** The open time list's row height and its cap, before it scrolls. */
const OPEN_TIME_ROW = 44;
const OPEN_TIME_MAX_HEIGHT = 320;

type OpenTimeEntry = Awaited<ReturnType<typeof loader>>["openTime"][number];

export default function ProjectTimeRoute() {
  const { t } = useLingui();
  const { ledger, count, openTime, elements } = useLoaderData<typeof loader>();
  const { formatDate } = useDateFormatter();
  const formatQuantity = useQuantityFormatter();

  const columns = useMemo<ColumnDef<OpenTimeEntry>[]>(
    () => [
      {
        id: "entryDate",
        header: t`Date`,
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {formatDate(row.original.entryDate)}
          </span>
        )
      },
      {
        id: "employeeId",
        header: t`Employee`,
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.employeeId} size="xxs" />
        )
      },
      {
        id: "element",
        header: () => (
          <LabelWithHelp termId="element" variant="inline">
            <Trans>Element</Trans>
          </LabelWithHelp>
        ),
        cell: ({ row }) =>
          row.original.element ? (
            <div className="flex max-w-[160px] items-center gap-2 @min-[56rem]:max-w-[260px]">
              <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                {row.original.element.readableId}
              </span>
              <span className="truncate">{row.original.element.name}</span>
            </div>
          ) : (
            <span className="text-muted-foreground">—</span>
          )
      },
      {
        id: "laborCategory",
        header: () => (
          <LabelWithHelp termId="labor-category" variant="inline">
            <Trans>Labor Category</Trans>
          </LabelWithHelp>
        ),
        cell: ({ row }) => (
          <span className="block max-w-[120px] truncate @min-[56rem]:max-w-none">
            {row.original.laborCategory?.name ?? "—"}
          </span>
        )
      },
      {
        id: "hours",
        header: t`Hours`,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatQuantity(row.original.hours)}
          </span>
        )
      },
      {
        id: "status",
        header: t`Status`,
        cell: ({ row }) => <TimesheetEntryStatus status={row.original.status} />
      },
      {
        id: "nextStep",
        header: () => (
          <span className="sr-only">
            <Trans>Next step</Trans>
          </span>
        ),
        cell: ({ row }) => <OpenTimeAction entry={row.original} />
      }
    ],
    [t, formatDate, formatQuantity]
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {/* A container: the table's long cells truncate to fit a narrow pane
          (1024 px with the sidebar open) instead of scrolling sideways. */}
      <section className="@container flex shrink-0 flex-col border-b border-border">
        <div className="flex h-12 items-center px-4">
          <h3 className="text-sm font-medium">
            <Trans>Time not posted yet</Trans>
          </h3>
        </div>
        {openTime.length === 0 ? (
          // One muted line, as on the Overview: the section sits above the
          // ledger, and an illustration here was louder than the data.
          <p className="px-4 pb-4 text-sm text-muted-foreground">
            <Trans>All time is posted</Trans>
          </p>
        ) : (
          <div
            style={{
              height: Math.min(
                48 + OPEN_TIME_ROW * openTime.length + 2,
                OPEN_TIME_MAX_HEIGHT
              )
            }}
          >
            <Table<OpenTimeEntry>
              compact
              columns={columns}
              data={openTime}
              count={openTime.length}
              sort={null}
              withPagination={false}
              withSearch={false}
              withColumnOrdering={false}
              withCsvExport={false}
              withSidebarTrigger={false}
            />
          </div>
        )}
      </section>
      <div className="flex h-12 shrink-0 items-center px-4">
        <h3 className="text-sm font-medium">
          <Trans>Costs posted</Trans>
        </h3>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <ProjectLedgerTable data={ledger} count={count} elements={elements} />
      </div>
    </div>
  );
}
