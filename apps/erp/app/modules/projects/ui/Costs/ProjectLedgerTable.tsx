// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import {
  LuBan,
  LuCalendar,
  LuCheck,
  LuCoins,
  LuFileText,
  LuHash,
  LuListTree,
  LuPackage,
  LuTag,
  LuUser
} from "react-icons/lu";
import { EmployeeAvatar, Hyperlink, Table } from "~/components";
import Empty from "~/components/Empty";
import { Enumerable } from "~/components/Enumerable";
import {
  useCurrencyFormatter,
  useDateFormatter,
  useQuantityFormatter
} from "~/hooks";
import { useItems, usePeople } from "~/stores";
import { path } from "~/utils/path";
import { projectCostTypes } from "../../projects.models";
import type { ProjectLedgerEntry } from "../../types";

type ElementLabel = { readableId: string; name: string };

type ProjectLedgerTableProps = {
  data: ProjectLedgerEntry[];
  count: number;
  /** The readable id and name of each element, by id. */
  elements: Record<string, ElementLabel>;
  title: string;
};

/** The page a project ledger row's document opens, when it has one. */
function documentPath(row: ProjectLedgerEntry): string | null {
  switch (row.documentType) {
    case "Purchase Receipt":
      return path.to.receipt(row.documentId);
    case "Purchase Invoice":
      return path.to.purchaseInvoice(row.documentId);
    case "Charge":
      return path.to.charge(row.documentId);
    case "Reimbursement":
      return path.to.reimbursement(row.documentId);
    default:
      return row.jobId ? path.to.job(row.jobId) : null;
  }
}

const ProjectLedgerTable = memo(
  ({ data, count, elements, title }: ProjectLedgerTableProps) => {
    const { t } = useLingui();
    const { formatDate } = useDateFormatter();
    const formatMoney = useCurrencyFormatter();
    const formatQuantity = useQuantityFormatter();
    const [items] = useItems();
    const [people] = usePeople();

    const itemsById = useMemo(
      () => new Map(items.map((item) => [item.id, item])),
      [items]
    );
    const peopleById = useMemo(
      () => new Map(people.map((person) => [person.id, person])),
      [people]
    );

    const columns = useMemo<ColumnDef<ProjectLedgerEntry>[]>(
      () => [
        {
          accessorKey: "postingDate",
          header: t`Posting Date`,
          cell: ({ row }) => (
            <span className="whitespace-nowrap tabular-nums">
              {formatDate(row.original.postingDate)}
            </span>
          ),
          meta: { icon: <LuCalendar /> }
        },
        {
          accessorKey: "projectElementId",
          header: t`Element`,
          cell: ({ row }) => {
            const element = row.original.projectElementId
              ? elements[row.original.projectElementId]
              : undefined;
            if (!element) {
              return <span className="text-muted-foreground">—</span>;
            }
            return (
              <div className="flex max-w-[260px] items-center gap-2">
                <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                  {element.readableId}
                </span>
                <span className="truncate">{element.name}</span>
              </div>
            );
          },
          meta: {
            icon: <LuListTree />,
            exportValue: (row: ProjectLedgerEntry) =>
              row.projectElementId
                ? (elements[row.projectElementId]?.readableId ?? null)
                : null
          }
        },
        {
          accessorKey: "costType",
          header: t`Cost Type`,
          cell: ({ row }) => <Enumerable value={row.original.costType} />,
          meta: {
            icon: <LuTag />,
            pluralHeader: t`Cost Types`,
            filter: {
              type: "static",
              options: projectCostTypes.map((costType) => ({
                value: costType,
                label: <Enumerable value={costType} />
              }))
            }
          }
        },
        {
          accessorKey: "documentType",
          header: t`Document`,
          cell: ({ row }) => {
            const to = documentPath(row.original);
            return to ? (
              <Hyperlink to={to}>
                <span className="whitespace-nowrap">
                  {row.original.documentType}
                </span>
              </Hyperlink>
            ) : (
              <span className="whitespace-nowrap">
                {row.original.documentType}
              </span>
            );
          },
          meta: { icon: <LuFileText /> }
        },
        {
          accessorKey: "itemId",
          header: t`Item`,
          cell: ({ row }) => {
            const item = row.original.itemId
              ? itemsById.get(row.original.itemId)
              : undefined;
            return item ? (
              <span className="whitespace-nowrap">
                {item.readableIdWithRevision}
              </span>
            ) : (
              <span className="text-muted-foreground">—</span>
            );
          },
          meta: {
            icon: <LuPackage />,
            exportValue: (row: ProjectLedgerEntry) =>
              row.itemId
                ? (itemsById.get(row.itemId)?.readableIdWithRevision ??
                  row.itemId)
                : null
          }
        },
        {
          accessorKey: "employeeId",
          header: t`Employee`,
          cell: ({ row }) =>
            row.original.employeeId ? (
              <EmployeeAvatar employeeId={row.original.employeeId} />
            ) : (
              <span className="text-muted-foreground">—</span>
            ),
          meta: {
            icon: <LuUser />,
            exportValue: (row: ProjectLedgerEntry) =>
              row.employeeId
                ? (peopleById.get(row.employeeId)?.name ?? row.employeeId)
                : null
          }
        },
        {
          accessorKey: "quantity",
          header: t`Quantity`,
          cell: ({ row }) =>
            row.original.quantity === null ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              <span className="whitespace-nowrap tabular-nums">
                {formatQuantity(row.original.quantity)}{" "}
                {row.original.unitOfMeasureCode ?? ""}
              </span>
            ),
          meta: { icon: <LuHash /> }
        },
        {
          accessorKey: "amount",
          header: t`Amount`,
          cell: ({ row }) => (
            <span className="tabular-nums">
              {formatMoney.format(row.original.amount)}
            </span>
          ),
          meta: { icon: <LuCoins /> }
        },
        {
          accessorKey: "unallowable",
          header: t`Unallowable`,
          cell: ({ row }) =>
            row.original.unallowable ? (
              <LuCheck
                className="size-4"
                aria-label={t`Unallowable`}
                role="img"
              />
            ) : null,
          meta: {
            icon: <LuBan />,
            filter: {
              type: "static",
              options: [
                { value: "true", label: t`Yes` },
                { value: "false", label: t`No` }
              ]
            }
          }
        }
      ],
      [
        elements,
        formatDate,
        formatMoney,
        formatQuantity,
        itemsById,
        peopleById,
        t
      ]
    );

    return (
      <Table<ProjectLedgerEntry>
        compact
        data={data}
        columns={columns}
        count={count}
        title={title}
        emptyState={
          <Empty
            title={<Trans>No costs posted yet</Trans>}
            description={null}
          />
        }
      />
    );
  }
);

ProjectLedgerTable.displayName = "ProjectLedgerTable";
export default ProjectLedgerTable;
