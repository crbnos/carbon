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
import { equals, INPUT_FORMAT, INPUT_STEP, round } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useMemo, useState } from "react";
import { LuPlus, LuRotateCcw, LuTrash } from "react-icons/lu";
import { useFetcher } from "react-router";
import { Table } from "~/components";
import { EditableDate, EditableNumber } from "~/components/Editable";
import { ConfirmDelete } from "~/components/Modals";
import {
  useCompanyToday,
  useCurrencyDecimals,
  useDateFormatter,
  usePermissions
} from "~/hooks";
import { path } from "~/utils/path";
import ContractAmountsModal from "./ContractAmountsModal";
import ContractMoney from "./ContractMoney";
import {
  contractGridHeight,
  contractLineName,
  lineColumnKey,
  useContractCellSave
} from "./contractGrid";
import type { ContractRouteData } from "./types";

type ContractInvoiceGridProps = Pick<
  ContractRouteData,
  "contract" | "lines" | "schedule" | "computedSchedule" | "lineTotals"
>;

/** One planned invoice as a grid row: its date, one amount per line (keyed
 *  `line0`, `line1`, …) and its total. */
type InvoiceRow = {
  /** The invoice's id, or `planned:<invoiceDate>` while the schedule is
   *  planned live — the server function resolves it on the first edit. */
  ref: string;
  invoiceDate: string;
  isEdited: boolean;
  total: number;
} & Record<string, string | number | boolean | null>;

type RowAmount = { lineId: string; amount: number; isAdjustment: boolean };

/**
 * The invoice schedule of a Draft as a spreadsheet: a row per planned
 * invoice, a column per line, each cell what that invoice bills for that
 * line. Editing only moves money (plan D10) — the footer shows what each
 * line still has to invoice, and Confirm waits for it to be zero.
 */
const ContractInvoiceGrid = ({
  contract,
  lines,
  schedule,
  computedSchedule,
  lineTotals
}: ContractInvoiceGridProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const save = useContractCellSave();
  const { formatDate } = useDateFormatter();
  const today = useCompanyToday();
  const resetFetcher = useFetcher<{}>();
  const addInvoice = useDisclosure();
  const [deleting, setDeleting] = useState<InvoiceRow | null>(null);

  const contractId = contract.id!;
  const currencyCode = contract.currencyCode ?? "USD";
  const decimals = useCurrencyDecimals(currencyCode);
  const canEdit = permissions.can("update", "sales");
  const action = path.to.contractSchedule(contractId);

  // Every invoice with its rows, persisted or planned live.
  const invoices = useMemo(
    () =>
      computedSchedule
        ? computedSchedule.map((invoice) => ({
            ref:
              invoice.status === "Planned"
                ? `planned:${invoice.invoiceDate}`
                : `${invoice.status}:${invoice.invoiceDate}`,
            invoiceDate: invoice.invoiceDate,
            status: invoice.status as string,
            isEdited: false,
            rows: invoice.rows.map<RowAmount>((row) => ({
              lineId: row.lineId,
              amount: row.amount,
              isAdjustment: row.isAdjustment
            }))
          }))
        : schedule.map((invoice) => ({
            ref: invoice.id,
            invoiceDate: invoice.invoiceDate,
            status: invoice.status as string,
            isEdited: invoice.isEdited,
            rows: invoice.customerContractInvoiceLine.map<RowAmount>((row) => ({
              lineId: row.customerContractLineId,
              amount: Number(row.amount),
              isAdjustment: row.isAdjustment
            }))
          })),
    [computedSchedule, schedule]
  );

  const planned = useMemo(
    () => invoices.filter((invoice) => invoice.status === "Planned"),
    [invoices]
  );
  const billedExternally = invoices.filter(
    (invoice) => invoice.status === "Billed Externally"
  );

  const rows = useMemo<InvoiceRow[]>(
    () =>
      planned.map((invoice) => {
        const row: InvoiceRow = {
          ref: invoice.ref,
          invoiceDate: invoice.invoiceDate,
          isEdited: invoice.isEdited,
          total: round(invoice.rows.reduce((sum, r) => sum + r.amount, 0))
        };
        lines.forEach((line, index) => {
          const amounts = invoice.rows.filter((r) => r.lineId === line.id);
          row[lineColumnKey(index)] =
            amounts.length > 0
              ? round(amounts.reduce((sum, r) => sum + r.amount, 0))
              : null;
        });
        return row;
      }),
    [planned, lines]
  );

  // What each line has left to invoice: what it computes to, less every row
  // billed for it (planned or billed externally). Adjustments are not part
  // of the conservation rule.
  const remaining = useMemo(() => {
    const billed = new Map<string, number>();
    for (const invoice of invoices) {
      for (const row of invoice.rows) {
        if (row.isAdjustment) continue;
        billed.set(row.lineId, (billed.get(row.lineId) ?? 0) + row.amount);
      }
    }
    return Object.fromEntries(
      lines.map((line) => [
        line.id,
        round((lineTotals[line.id] ?? 0) - (billed.get(line.id) ?? 0))
      ])
    );
  }, [invoices, lines, lineTotals]);
  const isBalanced = Object.values(remaining).every((r) => equals(r, 0));
  const isEdited = !computedSchedule && invoices.length > 0;

  const onCellEdit = useCallback(
    (accessorKey: string, value: unknown, row: InvoiceRow) => {
      if (accessorKey === "invoiceDate") {
        return save(action, {
          intent: "move",
          customerContractInvoiceId: row.ref,
          invoiceDate: String(value)
        });
      }
      const line = lines[Number(accessorKey.replace("line", ""))];
      return save(action, {
        intent: "setAmount",
        customerContractInvoiceId: row.ref,
        customerContractLineId: line?.id ?? "",
        amount: value === "" || value == null ? "0" : String(value)
      });
    },
    [action, lines, save]
  );

  const columns = useMemo<ColumnDef<InvoiceRow>[]>(
    () => [
      {
        accessorKey: "invoiceDate",
        header: t`Invoice Date`,
        cell: ({ row }) => (
          <span className="flex items-center gap-2 whitespace-nowrap">
            <span className="tabular-nums">
              {formatDate(row.original.invoiceDate)}
            </span>
            {row.original.isEdited && (
              <Badge variant="secondary">
                <Trans>Edited</Trans>
              </Badge>
            )}
          </span>
        ),
        footer: () => (
          <span className="text-muted-foreground">
            <Trans>Left to invoice</Trans>
          </span>
        )
      },
      ...lines.map<ColumnDef<InvoiceRow>>((line, index) => ({
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
            value={remaining[line.id] ?? 0}
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
            value={Object.values(remaining).reduce((sum, r) => sum + r, 0)}
            currencyCode={currencyCode}
          />
        )
      }
    ],
    [t, lines, currencyCode, formatDate, remaining]
  );

  const editableComponents = useMemo(() => {
    const amount = EditableNumber<InvoiceRow>(
      onCellEdit,
      {
        minValue: 0,
        step: INPUT_STEP.money(decimals),
        formatOptions: INPUT_FORMAT.money(currencyCode, decimals)
      },
      { clearable: true }
    );
    return {
      invoiceDate: EditableDate<InvoiceRow>(onCellEdit, {
        label: t`Invoice Date`
      }),
      ...Object.fromEntries(
        lines.map((_, index) => [lineColumnKey(index), amount])
      )
    };
  }, [onCellEdit, lines, currencyCode, decimals, t]);

  const renderContextMenu = useCallback(
    (row: InvoiceRow) => (
      <MenuItem
        shortcut={MENU_ITEM_SHORTCUTS.delete}
        destructive
        disabled={!canEdit}
        onClick={() => setDeleting(row)}
      >
        <MenuIcon icon={<LuTrash />} />
        <Trans>Delete Invoice</Trans>
      </MenuItem>
    ),
    [canEdit]
  );

  const lastDate = planned[planned.length - 1]?.invoiceDate;

  return (
    <div className="flex w-full flex-col gap-4">
      {billedExternally.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {billedExternally.length === 1 ? (
            <Trans>
              1 invoice was billed in your previous system and is not drafted
              again.
            </Trans>
          ) : (
            <Trans>
              {billedExternally.length} invoices were billed in your previous
              system and are not drafted again.
            </Trans>
          )}
        </p>
      )}

      {rows.length === 0 ? (
        <div className="flex w-full items-center justify-center rounded-lg border border-dashed border-border px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">
            {lines.length === 0 ? (
              <Trans>Add products to plan the invoices.</Trans>
            ) : (
              <Trans>No invoices planned. Add one to bill these lines.</Trans>
            )}
          </p>
        </div>
      ) : (
        <div
          className="w-full overflow-hidden rounded-lg border border-border"
          style={{ height: contractGridHeight(rows.length, 49) }}
        >
          <Table<InvoiceRow>
            compact
            columns={columns}
            data={rows}
            count={rows.length}
            editableComponents={editableComponents}
            renderContextMenu={renderContextMenu}
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
            onClick={addInvoice.onOpen}
          >
            <Trans>Add Invoice</Trans>
          </Button>
          {isEdited && (
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
              <Trans>Reset Schedule</Trans>
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
            computedSchedule ? (
              <Trans>
                Planned from the lines. Editing a cell saves the schedule.
              </Trans>
            ) : (
              <Trans>Every line is fully invoiced.</Trans>
            )
          ) : (
            <Trans>
              Some lines are invoiced for more or less than they total. Fix the
              amounts before confirming.
            </Trans>
          )}
        </p>
      </div>

      {addInvoice.isOpen && (
        <ContractAmountsModal
          intent="addInvoice"
          action={action}
          title={<Trans>Add Invoice</Trans>}
          description={
            <Trans>
              Each amount starts at what the line has left to invoice.
            </Trans>
          }
          lines={lines}
          defaults={remaining}
          defaultDate={lastDate ?? contract.startDate ?? today}
          currencyCode={currencyCode}
          onClose={addInvoice.onClose}
        />
      )}

      {deleting && (
        <ConfirmDelete
          action={action}
          fields={{
            intent: "delete",
            customerContractInvoiceId: deleting.ref
          }}
          name={formatDate(deleting.invoiceDate)}
          title={t`Delete the ${formatDate(deleting.invoiceDate)} invoice`}
          text={t`Its amounts go back to what each line has left to invoice.`}
          onCancel={() => setDeleting(null)}
          onSubmit={() => setDeleting(null)}
        />
      )}
    </div>
  );
};

/** A line's remainder in a grid footer: a dash when it is placed in full,
 *  red when it is not (a negative remainder places more than the line). */
export const Remaining = ({
  value,
  currencyCode
}: {
  value: number;
  currencyCode: string;
}) =>
  equals(value, 0) ? (
    <span className="text-muted-foreground">—</span>
  ) : (
    <span className="font-medium text-red-500">
      <ContractMoney value={value} currencyCode={currencyCode} />
    </span>
  );

export default ContractInvoiceGrid;
