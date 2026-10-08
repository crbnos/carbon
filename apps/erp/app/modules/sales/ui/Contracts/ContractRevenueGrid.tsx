// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Badge,
  Button,
  cn,
  MENU_ITEM_SHORTCUTS,
  MenuIcon,
  MenuItem,
  useDisclosure
} from "@carbon/react";
import {
  equals,
  INPUT_FORMAT,
  INPUT_STEP,
  lineRevenueDates,
  nextMonth,
  round
} from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useMemo, useState } from "react";
import { LuPlus, LuRotateCcw, LuTrash } from "react-icons/lu";
import { useFetcher } from "react-router";
import { Table } from "~/components";
import {
  EditableDate,
  EditableList,
  EditableNumber
} from "~/components/Editable";
import { ConfirmDelete } from "~/components/Modals";
import {
  rowMenuColumn,
  setupGridHeight,
  useCellSave
} from "~/components/Setup";
import {
  useCompanyToday,
  useCurrencyDecimals,
  useDateFormatter,
  usePermissions
} from "~/hooks";
import { path } from "~/utils/path";
import { contractRevenueMethods } from "../../sales.models";
import ContractAmountsModal from "./ContractAmountsModal";
import { Remaining } from "./ContractInvoiceGrid";
import ContractMoney from "./ContractMoney";
import { contractLineName, lineColumnKey } from "./contractGrid";
import type { ContractLine, ContractRouteData } from "./types";

type ContractRevenueGridProps = Pick<
  ContractRouteData,
  "contract" | "lines" | "revenueRows" | "revenueIsStored" | "revenueResiduals"
>;

/** One month of the plan: the month, one amount per line (`line0`, …) and
 *  the month's total. */
type MonthRow = {
  periodStart: string;
  isExternal: boolean;
  total: number;
} & Record<string, string | number | boolean | null>;

/** A line's recognition settings, edited in place. */
type RecognitionRow = {
  id: string;
  name: string;
  revenueMethod: ContractLine["revenueMethod"];
  goLiveDate: string | null;
  revenueStartDate: string | null;
  revenueEndDate: string | null;
  /** Where revenue starts and ends when the dates above are empty. */
  defaultStart: string;
  defaultEnd: string | null;
};

/**
 * How each line's revenue falls, month by month (plan D11): each line's
 * method and dates, then the plan itself — a row per month, a column per
 * line. Editing only moves revenue between months; the footer shows what
 * each line has left to recognize against what it bills.
 */
const ContractRevenueGrid = ({
  contract,
  lines,
  revenueRows,
  revenueIsStored,
  revenueResiduals
}: ContractRevenueGridProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const save = useCellSave();
  const { formatDate } = useDateFormatter();
  const today = useCompanyToday();
  const resetFetcher = useFetcher<{}>();
  const addMonth = useDisclosure();
  const [deleting, setDeleting] = useState<MonthRow | null>(null);

  const contractId = contract.id!;
  const { currencyCode } = contract;
  const decimals = useCurrencyDecimals(currencyCode);
  const canEdit = permissions.can("update", "sales");
  const action = path.to.contractRevenue(contractId);
  const monthLabel = useCallback(
    (date: string) => formatDate(date, { month: "short", year: "numeric" }),
    [formatDate]
  );

  const months = useMemo<MonthRow[]>(() => {
    const byMonth = new Map<string, typeof revenueRows>();
    for (const row of revenueRows) {
      byMonth.set(row.periodStart, [
        ...(byMonth.get(row.periodStart) ?? []),
        row
      ]);
    }
    return [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([periodStart, entries]) => {
        const month: MonthRow = {
          periodStart,
          isExternal: entries.every(
            (entry) => entry.status === "Recognized Externally"
          ),
          total: round(entries.reduce((sum, entry) => sum + entry.amount, 0))
        };
        lines.forEach((line, index) => {
          const amounts = entries.filter((entry) => entry.lineId === line.id);
          month[lineColumnKey(index)] =
            amounts.length > 0
              ? round(amounts.reduce((sum, entry) => sum + entry.amount, 0))
              : null;
        });
        return month;
      });
  }, [revenueRows, lines]);

  const isBalanced = Object.values(revenueResiduals).every((r) => equals(r, 0));

  const onCellEdit = useCallback(
    (accessorKey: string, value: unknown, row: MonthRow) => {
      const line = lines[Number(accessorKey.replace("line", ""))];
      return save(action, {
        intent: "setAmount",
        customerContractLineId: line?.id ?? "",
        periodStart: row.periodStart,
        amount: value === "" || value == null ? "0" : String(value)
      });
    },
    [action, lines, save]
  );

  const columns = useMemo<ColumnDef<MonthRow>[]>(
    () => [
      {
        accessorKey: "periodStart",
        header: t`Month`,
        cell: ({ row }) => (
          <span className="flex items-center gap-2 whitespace-nowrap">
            <span className="tabular-nums">
              {monthLabel(row.original.periodStart)}
            </span>
            {row.original.isExternal && (
              <Badge variant="secondary">
                <Trans>Recognized externally</Trans>
              </Badge>
            )}
          </span>
        ),
        footer: () => (
          <span className="text-muted-foreground">
            <Trans>Left to recognize</Trans>
          </span>
        )
      },
      ...lines.map<ColumnDef<MonthRow>>((line, index) => ({
        accessorKey: lineColumnKey(index),
        header: () => (
          <span className="block max-w-[160px] truncate">
            {contractLineName(line)}
          </span>
        ),
        cell: ({ row }) => {
          const value = row.original[lineColumnKey(index)];
          return typeof value === "number" ? (
            <ContractMoney value={value} currencyCode={currencyCode} />
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        },
        footer: () => (
          <Remaining
            value={revenueResiduals[line.id] ?? 0}
            currencyCode={currencyCode}
          />
        )
      })),
      {
        id: "total",
        header: t`Total`,
        cell: ({ row }) => (
          <span className="font-medium">
            <ContractMoney
              value={row.original.total}
              currencyCode={currencyCode}
            />
          </span>
        ),
        footer: () => (
          <Remaining
            value={Object.values(revenueResiduals).reduce(
              (sum, r) => sum + r,
              0
            )}
            currencyCode={currencyCode}
          />
        )
      }
    ],
    [t, lines, currencyCode, monthLabel, revenueResiduals]
  );

  const editableComponents = useMemo(() => {
    const amount = EditableNumber<MonthRow>(
      onCellEdit,
      {
        minValue: 0,
        step: INPUT_STEP.money(decimals),
        formatOptions: INPUT_FORMAT.money(currencyCode, decimals)
      },
      { clearable: true }
    );
    return Object.fromEntries(
      lines.map((_, index) => [lineColumnKey(index), amount])
    );
  }, [onCellEdit, lines, currencyCode, decimals]);

  const renderContextMenu = useCallback(
    (row: MonthRow) => (
      <MenuItem
        shortcut={MENU_ITEM_SHORTCUTS.delete}
        destructive
        disabled={!canEdit}
        onClick={() => setDeleting(row)}
      >
        <MenuIcon icon={<LuTrash />} />
        <Trans>Delete Month</Trans>
      </MenuItem>
    ),
    [canEdit]
  );

  const gridColumns = useMemo(
    () => [...columns, rowMenuColumn(renderContextMenu, t`Actions`)],
    [columns, renderContextMenu, t]
  );

  const lastMonth = months[months.length - 1]?.periodStart;

  return (
    <div className="flex w-full flex-col gap-4">
      {months.length === 0 ? (
        <div className="flex w-full items-center justify-center rounded-lg border border-dashed border-border px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">
            {lines.length === 0 ? (
              <Trans>Add services to plan the revenue.</Trans>
            ) : (
              <Trans>
                Nothing to recognize yet. Revenue follows what the invoices
                bill.
              </Trans>
            )}
          </p>
        </div>
      ) : (
        <div
          className="w-full overflow-hidden rounded-lg border border-border"
          style={{ height: setupGridHeight(months.length, 49) }}
        >
          <Table<MonthRow>
            compact
            columns={gridColumns}
            data={months}
            count={months.length}
            editableComponents={editableComponents}
            withInlineEditing={canEdit}
            forceEditMode={canEdit}
            withPagination={false}
            withSearch={false}
            withSimpleSorting={false}
            withSidebarTrigger={false}
            withColumnOrdering={false}
            withCsvExport={false}
            sort={null}
          />
        </div>
      )}

      <div className="flex w-full flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            leftIcon={<LuPlus />}
            isDisabled={!canEdit || lines.length === 0}
            onClick={addMonth.onOpen}
          >
            <Trans>Add Month</Trans>
          </Button>
          {revenueIsStored && (
            <Button
              variant="ghost"
              leftIcon={<LuRotateCcw />}
              isDisabled={!canEdit || resetFetcher.state !== "idle"}
              isLoading={resetFetcher.state !== "idle"}
              onClick={() =>
                resetFetcher.submit(
                  { intent: "reset" },
                  { method: "post", action }
                )
              }
            >
              <Trans>Reset Revenue</Trans>
            </Button>
          )}
        </div>
        <p
          className={cn(
            "text-xs",
            isBalanced ? "text-muted-foreground" : "text-red-500"
          )}
        >
          {isBalanced ? (
            revenueIsStored ? (
              <Trans>Every line recognizes what it bills.</Trans>
            ) : (
              <Trans>
                Planned from the invoices. Editing a cell saves the plan.
              </Trans>
            )
          ) : (
            <Trans>
              Some lines recognize more or less than they bill. Place what is
              left before confirming.
            </Trans>
          )}
        </p>
      </div>

      {addMonth.isOpen && (
        <ContractAmountsModal
          intent="addMonth"
          action={action}
          title={<Trans>Add Month</Trans>}
          description={
            <Trans>
              Each amount starts at what the line has left to recognize.
            </Trans>
          }
          lines={lines}
          defaults={revenueResiduals}
          defaultDate={
            lastMonth ? nextMonth(lastMonth) : (contract.startDate ?? today)
          }
          currencyCode={currencyCode}
          onClose={addMonth.onClose}
        />
      )}

      {deleting && (
        <ConfirmDelete
          action={action}
          fields={{ intent: "deleteMonth", periodStart: deleting.periodStart }}
          name={monthLabel(deleting.periodStart)}
          title={t`Delete ${monthLabel(deleting.periodStart)}`}
          text={t`Its revenue goes back to what each line has left to recognize.`}
          onCancel={() => setDeleting(null)}
          onSubmit={() => setDeleting(null)}
        />
      )}
    </div>
  );
};

/** Each line's revenue method and dates, edited in place through the line's
 *  update route. Empty dates fall back to the line's go-live, start and end
 *  dates — shown muted. */
export const ContractRecognitionGrid = ({
  contract,
  lines
}: Pick<ContractRouteData, "contract" | "lines">) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const save = useCellSave();
  const { formatDate } = useDateFormatter();

  const contractId = contract.id!;
  const canEdit = permissions.can("update", "sales");
  const methodLabels = useMemo<Record<ContractLine["revenueMethod"], string>>(
    () => ({ Daily: t`Daily`, "Even Period": t`Even Period` }),
    [t]
  );

  const rows = useMemo<RecognitionRow[]>(
    () =>
      lines.map((line) => {
        const dates = lineRevenueDates(line);
        return {
          id: line.id,
          name: contractLineName(line),
          revenueMethod: line.revenueMethod,
          goLiveDate: line.goLiveDate,
          revenueStartDate: line.revenueStartDate,
          revenueEndDate: line.revenueEndDate,
          defaultStart: dates.start,
          // A line with no end of its own earns until the contract ends.
          defaultEnd: dates.end ?? contract.endDate ?? null
        };
      }),
    [lines, contract.endDate]
  );

  const onCellEdit = useCallback(
    (accessorKey: string, value: unknown, row: RecognitionRow) =>
      save(path.to.contractLineUpdate(contractId, row.id), {
        field: accessorKey,
        value: value === null || value === undefined ? "" : String(value)
      }),
    [contractId, save]
  );

  const dateCell = useCallback(
    (value: string | null, fallback: string | null) =>
      value ? (
        <span className="tabular-nums">{formatDate(value)}</span>
      ) : fallback ? (
        <span className="tabular-nums text-muted-foreground">
          {formatDate(fallback)}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    [formatDate]
  );

  const columns = useMemo<ColumnDef<RecognitionRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: t`Service`,
        cell: ({ row }) => (
          <span className="block max-w-[260px] truncate font-medium">
            {row.original.name}
          </span>
        )
      },
      {
        accessorKey: "revenueMethod",
        header: t`Method`,
        cell: ({ row }) => methodLabels[row.original.revenueMethod]
      },
      {
        accessorKey: "goLiveDate",
        header: t`Go-Live`,
        cell: ({ row }) => dateCell(row.original.goLiveDate, null)
      },
      {
        accessorKey: "revenueStartDate",
        header: t`Revenue Start`,
        cell: ({ row }) =>
          dateCell(row.original.revenueStartDate, row.original.defaultStart)
      },
      {
        accessorKey: "revenueEndDate",
        header: t`Revenue End`,
        cell: ({ row }) =>
          dateCell(row.original.revenueEndDate, row.original.defaultEnd)
      }
    ],
    [t, dateCell, methodLabels]
  );

  const editableComponents = useMemo(
    () => ({
      revenueMethod: EditableList<RecognitionRow>(
        onCellEdit,
        contractRevenueMethods.map((value) => ({
          value,
          label: methodLabels[value]
        }))
      ),
      goLiveDate: EditableDate<RecognitionRow>(onCellEdit, {
        label: t`Go-Live`,
        clearable: true
      }),
      revenueStartDate: EditableDate<RecognitionRow>(onCellEdit, {
        label: t`Revenue Start`,
        clearable: true
      }),
      revenueEndDate: EditableDate<RecognitionRow>(onCellEdit, {
        label: t`Revenue End`,
        clearable: true,
        bounds: (row) => ({
          minValue: row.revenueStartDate ?? row.defaultStart
        })
      })
    }),
    [onCellEdit, t, methodLabels]
  );

  if (rows.length === 0) return null;

  return (
    <div
      className="w-full overflow-hidden rounded-lg border border-border"
      style={{ height: setupGridHeight(rows.length) }}
    >
      <Table<RecognitionRow>
        compact
        columns={columns}
        data={rows}
        count={rows.length}
        editableComponents={editableComponents}
        withInlineEditing={canEdit}
        forceEditMode={canEdit}
        withPagination={false}
        withSearch={false}
        withSimpleSorting={false}
        withSidebarTrigger={false}
        withColumnOrdering={false}
        withCsvExport={false}
        sort={null}
      />
    </div>
  );
};

export default ContractRevenueGrid;
