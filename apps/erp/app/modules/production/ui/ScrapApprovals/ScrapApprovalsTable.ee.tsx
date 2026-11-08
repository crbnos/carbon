// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Database } from "@carbon/database";
import { Status } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import {
  LuBox,
  LuCalendar,
  LuCircleCheck,
  LuCirclePlay,
  LuCoins,
  LuHash,
  LuShieldCheck,
  LuTrash,
  LuUser
} from "react-icons/lu";
import { DateTime, EmployeeAvatar, Hyperlink, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useCurrencyFormatter } from "~/hooks";
import { path } from "~/utils/path";

export type ScrapApproval = Database["public"]["Views"]["scrapRequests"]["Row"];

type ScrapApprovalsTableProps = {
  data: ScrapApproval[];
  count: number;
};

const ScrapApprovalsTable = memo(
  ({ data, count }: ScrapApprovalsTableProps) => {
    const { t } = useLingui();
    const currencyFormatter = useCurrencyFormatter();

    const columns = useMemo<ColumnDef<ScrapApproval>[]>(
      () => [
        {
          accessorKey: "jobReadableId",
          header: t`Job`,
          enableSorting: false,
          cell: ({ row }) =>
            row.original.jobId ? (
              <Hyperlink
                to={path.to.jobProductionQuantities(row.original.jobId)}
              >
                {row.original.jobReadableId}
              </Hyperlink>
            ) : (
              // A batch can span jobs: it names the batch instead.
              row.original.batchReadableId
            ),
          meta: {
            mobile: "P1",
            icon: <LuCirclePlay />,
            exportValue: (row: ScrapApproval) =>
              row.jobReadableId ?? row.batchReadableId
          }
        },
        {
          accessorKey: "itemReadableId",
          header: t`Item`,
          enableSorting: false,
          cell: ({ row }) => (
            <div className="flex flex-col">
              <span>{row.original.itemReadableId}</span>
              {row.original.trackedEntityReadableId && (
                <span className="text-xs text-muted-foreground">
                  {row.original.trackedEntityReadableId}
                </span>
              )}
            </div>
          ),
          meta: {
            mobile: "P2",
            icon: <LuBox />,
            exportValue: (row: ScrapApproval) => row.itemReadableId
          }
        },
        {
          accessorKey: "quantity",
          header: t`Quantity`,
          enableSorting: false,
          cell: ({ row }) => (
            <span className="tabular-nums">{row.original.quantity}</span>
          ),
          meta: { icon: <LuHash /> }
        },
        {
          accessorKey: "scrapReasonName",
          header: t`Reason`,
          enableSorting: false,
          cell: ({ row }) => (
            <Enumerable value={row.original.scrapReasonName} />
          ),
          meta: { icon: <LuTrash /> }
        },
        {
          accessorKey: "estimatedValue",
          header: t`Estimated Value`,
          enableSorting: false,
          cell: ({ row }) => (
            <span className="tabular-nums">
              {currencyFormatter.format(row.original.estimatedValue ?? 0)}
            </span>
          ),
          meta: {
            mobile: "P3",
            icon: <LuCoins />,
            exportValue: (row: ScrapApproval) => row.estimatedValue
          }
        },
        {
          accessorKey: "createdBy",
          header: t`Recorded By`,
          enableSorting: false,
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.createdBy} />
          ),
          meta: { icon: <LuUser /> }
        },
        {
          accessorKey: "approvedBy",
          header: t`Approved By`,
          enableSorting: false,
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.approvedBy} />
          ),
          meta: { icon: <LuShieldCheck /> }
        },
        {
          accessorKey: "postedAt",
          header: t`Posted`,
          enableSorting: false,
          cell: ({ row }) =>
            row.original.postedAt ? (
              <Status color="green">{t`Posted`}</Status>
            ) : (
              // Approved, but the posting never confirmed: it failed without
              // a refusal, or is still running. Check the job's scrap.
              <Status color="yellow">{t`Not confirmed`}</Status>
            ),
          meta: {
            icon: <LuCircleCheck />,
            exportValue: (row: ScrapApproval) =>
              row.postedAt ? t`Posted` : t`Not confirmed`
          }
        },
        {
          accessorKey: "approvedAt",
          header: t`Approved At`,
          enableSorting: false,
          cell: ({ row }) =>
            row.original.approvedAt ? (
              <DateTime value={row.original.approvedAt} />
            ) : null,
          meta: { icon: <LuCalendar /> }
        }
      ],
      [currencyFormatter, t]
    );

    return (
      <Table<ScrapApproval>
        data={data}
        columns={columns}
        count={count}
        // Newest first; the list is an audit trail, not a worklist.
        sort={null}
        title={t`Scrap Approvals`}
      />
    );
  }
);

ScrapApprovalsTable.displayName = "ScrapApprovalsTable";
export default ScrapApprovalsTable;
