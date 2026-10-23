// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  LabelWithHelp,
  MenuIcon,
  MenuItem
} from "@carbon/react";
import { BILLABLE_REASON_FUNDING_LIMIT } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { memo, useCallback, useMemo, useState } from "react";
import { LuBan, LuCirclePause, LuCirclePlay, LuPencil } from "react-icons/lu";
import { Hyperlink, Table } from "~/components";
import {
  useCurrencyFormatter,
  useDateFormatter,
  usePermissions,
  useQuantityFormatter
} from "~/hooks";
import { BillableItemStatus } from "~/modules/service/ui/ServiceStatus";
import { path } from "~/utils/path";
import type {
  BillableItemAction,
  ProjectCostType
} from "../../projects.models";
import type { ContractBillableItem } from "../../types";
import BillableItemActionModal from "./BillableItemActionModal";

const STATUSES = ["Unbilled", "On Hold", "Billed", "Written Off"] as const;

type FilterOption = { value: string; label: string };

/**
 * Contract billable items to review before they bill: Hold (with a reason),
 * Release, Write Off (with a reason) and Edit Price (one item). Billed and
 * written off items show for reference and take no action.
 */
const ProjectBillableItemsTable = memo(
  ({
    data,
    count,
    projects,
    lines,
    title,
    emptyState
  }: {
    data: ContractBillableItem[];
    count: number;
    /** Filter options; omitted on a project's own Billing tab. */
    projects?: FilterOption[];
    lines: FilterOption[];
    /** The toolbar title; omitted where the page draws its own heading. */
    title?: string;
    emptyState?: ReactNode;
  }) => {
    const { t } = useLingui();
    const permissions = usePermissions();
    const formatCurrency = useCurrencyFormatter();
    const formatRate = useCurrencyFormatter({ rate: true });
    const formatQuantity = useQuantityFormatter();
    const { formatDate } = useDateFormatter();
    const canUpdate = permissions.can("update", "projects");
    const [acting, setActing] = useState<{
      action: BillableItemAction;
      items: ContractBillableItem[];
    } | null>(null);

    const columns = useMemo<ColumnDef<ContractBillableItem>[]>(() => {
      const costTypeLabels: Record<ProjectCostType, string> = {
        Material: t`Material`,
        Labor: t`Labor`,
        Machine: t`Machine`,
        Overhead: t`Overhead`,
        "Outside Processing": t`Outside Processing`,
        "Purchased Service": t`Purchased Service`,
        "Other Direct": t`Other Direct`,
        "Material Variance": t`Material Variance`,
        "Payback Variance": t`Payback Variance`,
        Burden: t`Burden`
      };
      return [
        {
          id: "postingDate",
          header: t`Posted`,
          cell: ({ row }) =>
            row.original.ledger
              ? formatDate(row.original.ledger.postingDate)
              : "—",
          meta: { exportValue: (row) => row.ledger?.postingDate ?? null }
        },
        ...(projects
          ? [
              {
                accessorKey: "projectId",
                header: t`Project`,
                cell: ({ row }) =>
                  row.original.project ? (
                    <Hyperlink
                      to={path.to.projectBilling(row.original.project.id)}
                    >
                      {row.original.project.identifier}
                    </Hyperlink>
                  ) : (
                    "—"
                  ),
                meta: {
                  filter: { type: "static", options: projects },
                  exportValue: (row) => row.project?.identifier ?? null
                }
              } satisfies ColumnDef<ContractBillableItem>
            ]
          : []),
        {
          accessorKey: "customerContractLineId",
          header: t`Contract Line`,
          cell: ({ row }) =>
            row.original.contractLine ? (
              <Hyperlink
                to={path.to.contractLineBilling(
                  row.original.contractLine.customerContractId,
                  row.original.contractLine.id
                )}
              >
                {lines.find(
                  (line) => line.value === row.original.contractLine?.id
                )?.label ?? row.original.contractLine.id}
              </Hyperlink>
            ) : (
              "—"
            ),
          meta: {
            filter: { type: "static", options: lines },
            exportValue: (row) =>
              lines.find((line) => line.value === row.customerContractLineId)
                ?.label ?? null
          }
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
              <span className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 whitespace-nowrap font-medium">
                  {row.original.element.readableId}
                </span>
                <span className="truncate">{row.original.element.name}</span>
              </span>
            ) : (
              "—"
            ),
          meta: {
            filterHeader: t`Element`,
            exportValue: (row) => row.element?.readableId ?? null
          }
        },
        {
          id: "costType",
          header: t`Cost Type`,
          cell: ({ row }) =>
            row.original.ledger
              ? costTypeLabels[row.original.ledger.costType]
              : "—",
          meta: {
            exportValue: (row) =>
              row.ledger ? costTypeLabels[row.ledger.costType] : null
          }
        },
        {
          accessorKey: "description",
          header: t`Description`,
          cell: ({ row }) => (
            <span className="block max-w-[260px] truncate">
              {row.original.description}
            </span>
          )
        },
        {
          accessorKey: "quantity",
          header: t`Quantity`,
          cell: ({ row }) => (
            <span className="tabular-nums">
              {formatQuantity(Number(row.original.quantity))}
            </span>
          )
        },
        {
          accessorKey: "unitPrice",
          header: t`Unit Price`,
          cell: ({ row }) => (
            <span className="tabular-nums">
              {formatRate.format(Number(row.original.unitPrice))}
            </span>
          )
        },
        {
          accessorKey: "amount",
          header: t`Amount`,
          cell: ({ row }) => (
            <span className="tabular-nums">
              {formatCurrency.format(Number(row.original.amount))}
            </span>
          )
        },
        {
          accessorKey: "status",
          header: t`Status`,
          cell: ({ row }) => (
            <BillableItemStatus status={row.original.status} />
          ),
          meta: {
            filter: {
              type: "static",
              options: STATUSES.map((status) => ({
                value: status,
                label: <BillableItemStatus status={status} />
              }))
            }
          }
        },
        {
          accessorKey: "statusReason",
          header: t`Reason`,
          cell: ({ row }) =>
            row.original.statusReason ? (
              <span
                className={
                  row.original.statusReason === BILLABLE_REASON_FUNDING_LIMIT
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-muted-foreground"
                }
              >
                {row.original.statusReason}
              </span>
            ) : (
              "—"
            )
        }
      ];
    }, [
      t,
      projects,
      lines,
      formatDate,
      formatQuantity,
      formatRate,
      formatCurrency
    ]);

    const open = useCallback(
      (action: BillableItemAction, items: ContractBillableItem[]) =>
        setActing({ action, items }),
      []
    );

    const renderActions = useCallback(
      (selected: ContractBillableItem[]) => {
        const open_ = selected.filter(
          (item) => item.status === "Unbilled" || item.status === "On Hold"
        );
        const held = open_.filter((item) => item.status === "On Hold");
        return (
          <DropdownMenuContent align="end" className="min-w-[200px]">
            <DropdownMenuLabel>
              <Trans>Review</Trans>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                disabled={!canUpdate || open_.length === 0}
                onClick={() => open("hold", open_)}
              >
                <LuCirclePause className="mr-2 size-4" />
                <Trans>Hold</Trans>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canUpdate || held.length === 0}
                onClick={() => open("release", held)}
              >
                <LuCirclePlay className="mr-2 size-4" />
                <Trans>Release</Trans>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canUpdate || open_.length === 0}
                onClick={() => open("writeOff", open_)}
              >
                <LuBan className="mr-2 size-4" />
                <Trans>Write Off</Trans>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={
                  !canUpdate ||
                  open_.length !== 1 ||
                  selected.length !== 1 ||
                  !!open_[0]?.reversalOfId
                }
                onClick={() => open("price", open_)}
              >
                <LuPencil className="mr-2 size-4" />
                <Trans>Edit Price</Trans>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        );
      },
      [canUpdate, open]
    );

    const renderContextMenu = useCallback(
      (item: ContractBillableItem) => {
        const isOpen = item.status === "Unbilled" || item.status === "On Hold";
        const disabled = !canUpdate || !isOpen;
        return (
          <>
            <MenuItem
              disabled={disabled || !!item.reversalOfId}
              onClick={() => open("price", [item])}
            >
              <MenuIcon icon={<LuPencil />} />
              <Trans>Edit Price</Trans>
            </MenuItem>
            {item.status === "On Hold" ? (
              <MenuItem
                disabled={disabled}
                onClick={() => open("release", [item])}
              >
                <MenuIcon icon={<LuCirclePlay />} />
                <Trans>Release</Trans>
              </MenuItem>
            ) : (
              <MenuItem
                disabled={disabled}
                onClick={() => open("hold", [item])}
              >
                <MenuIcon icon={<LuCirclePause />} />
                <Trans>Hold</Trans>
              </MenuItem>
            )}
            <MenuItem
              destructive
              disabled={disabled}
              onClick={() => open("writeOff", [item])}
            >
              <MenuIcon icon={<LuBan />} />
              <Trans>Write Off</Trans>
            </MenuItem>
          </>
        );
      },
      [canUpdate, open]
    );

    return (
      <>
        <Table<ContractBillableItem>
          count={count}
          columns={columns}
          data={data}
          title={title}
          emptyState={emptyState}
          renderActions={renderActions}
          renderContextMenu={renderContextMenu}
          withSelectableRows={canUpdate}
        />
        {acting && (
          <BillableItemActionModal
            action={acting.action}
            items={acting.items}
            onClose={() => setActing(null)}
          />
        )}
      </>
    );
  }
);

ProjectBillableItemsTable.displayName = "ProjectBillableItemsTable";

export default ProjectBillableItemsTable;
