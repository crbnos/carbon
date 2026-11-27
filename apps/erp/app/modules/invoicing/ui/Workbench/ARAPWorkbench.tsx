// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  cn,
  DatePicker,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  HStack,
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VStack
} from "@carbon/react";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useMemo, useState } from "react";
import {
  LuChevronDown,
  LuChevronRight,
  LuDownload,
  LuScale,
  LuTriangleAlert,
  LuUser
} from "react-icons/lu";
import { Link, useFetcher } from "react-router";
import { CustomerAvatar, DateTime, SupplierAvatar, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { IndeterminateCheckbox } from "~/components/Table/components";
import { useCurrencyFormatter, usePermissions, useUrlParams } from "~/hooks";
import {
  agingBucketMessages,
  daysPastDue
} from "~/modules/invoicing/invoicing.reports";
import { path } from "~/utils/path";
import { CounterpartyDocuments } from "./CounterpartyDocuments";
import type {
  AgingRow,
  OpenInvoiceRow,
  OpenPaymentRow,
  WorkbenchRow
} from "./types";
import { useWorkbenchSelection } from "./useWorkbenchSelection";

type TieOutResult = {
  subledgerBalance: number;
  glBalance: number;
  variance: number;
};

type ARAPWorkbenchProps = {
  side: "ar" | "ap";
  result: TieOutResult | null;
  aging: AgingRow[];
  open: OpenInvoiceRow[];
  payments?: OpenPaymentRow[];
  asOfDate: string;
  agingMethod: "dueDate" | "documentDate";
  bucketDays: [number, number, number];
  // Overrides the table title. Defaults to Receivables/Payables (the invoicing
  // workbench); the aging reports pass "AR Aging" / "AP Aging".
  title?: string;
  /** The report pages show document details in an expanded table. */
  reportDetails?: boolean;
  /** By invoice id, what Draft payments apply to it, in base. They pay
   *  nothing until posted, so they stay out of every bucket and total. */
  pending?: Record<string, number>;
};

// Tolerance mirrors TieOut/Dashboard: swallow floating-point dust in the
// subledger-vs-GL comparison.
const VARIANCE_EPSILON = 0.005;

// Single workbench rendered by both the receivables and payables routes. The
// two routes differ only in which RPCs they call; the presentation is shared.
export function ARAPWorkbench({
  side,
  result,
  aging,
  open,
  payments = [],
  asOfDate,
  agingMethod,
  bucketDays,
  title,
  reportDetails = false,
  pending
}: ARAPWorkbenchProps) {
  const { t, i18n } = useLingui();
  const [, setParams] = useUrlParams();
  const adjustFetcher = useFetcher();
  const permissions = usePermissions();
  const currencyFormatter = useCurrencyFormatter();
  const bucketMessages = agingBucketMessages(bucketDays);

  const money = useCallback(
    (n: number) => currencyFormatter.format(Number(n)),
    [currencyFormatter]
  );
  const partyIdOf = useCallback(
    (r: { customerId?: string; supplierId?: string }) =>
      side === "ar" ? r.customerId : r.supplierId,
    [side]
  );

  // Group open invoices under their counterparty so expanding a row reveals
  // exactly the invoices that make up its balance. Pre-grouped from the loader
  // payload — no lazy fetch.
  const childrenByParty = useMemo(() => {
    const map: Record<string, OpenInvoiceRow[]> = {};
    for (const inv of open) {
      const pid = partyIdOf(inv);
      if (!pid) continue;
      (map[pid] ??= []).push(inv);
    }
    return map;
  }, [open, partyIdOf]);
  const pendingByParty = useMemo(() => {
    const map: Record<string, number> = {};
    if (!pending) return map;
    for (const [partyId, invoices] of Object.entries(childrenByParty)) {
      for (const inv of invoices) {
        const amount = pending[inv.invoiceId];
        if (amount) map[partyId] = (map[partyId] ?? 0) + amount;
      }
    }
    return map;
  }, [pending, childrenByParty]);
  const paymentsByParty = useMemo(() => {
    const map: Record<string, OpenPaymentRow[]> = {};
    for (const payment of payments) {
      const partyId = partyIdOf(payment);
      if (!partyId) continue;
      (map[partyId] ??= []).push(payment);
    }
    return map;
  }, [payments, partyIdOf]);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Flatten counterparties (roots) and, for expanded ones, their invoices.
  const displayRows = useMemo<WorkbenchRow[]>(() => {
    const out: WorkbenchRow[] = [];
    const allAging = [...aging];
    if (reportDetails) {
      const known = new Set(aging.map(partyIdOf));
      for (const partyId of [
        ...Object.keys(childrenByParty),
        ...Object.keys(paymentsByParty)
      ]) {
        if (known.has(partyId)) continue;
        known.add(partyId);
        allAging.push({
          ...(side === "ar"
            ? { customerId: partyId }
            : { supplierId: partyId }),
          current: 0,
          bucket1: 0,
          bucket2: 0,
          bucket3: 0,
          bucket4: 0,
          unapplied: 0,
          total: 0
        });
      }
    }
    for (const a of allAging) {
      const pid = partyIdOf(a);
      if (!pid) continue;
      out.push({ kind: "counterparty", id: pid, partyId: pid, ...a });
      if (!reportDetails && expandedIds.has(pid)) {
        for (const inv of childrenByParty[pid] ?? []) {
          out.push({
            kind: "invoice",
            id: inv.invoiceId,
            partyId: pid,
            ...inv
          });
        }
      }
    }
    return out;
  }, [
    aging,
    childrenByParty,
    expandedIds,
    partyIdOf,
    paymentsByParty,
    reportDetails,
    side
  ]);

  const {
    selectedIds,
    selectTreeRow,
    selectDocument,
    selectedInvoices,
    sameParty,
    payHref
  } = useWorkbenchSelection({
    side,
    open,
    childrenByParty,
    displayRows,
    partyIdOf
  });

  const exportParams = new URLSearchParams({
    asOfDate,
    agingMethod,
    bucketDays: bucketDays.join(",")
  });
  const exportHref = `${side === "ar" ? path.to.arAgingCsv : path.to.apAgingCsv}?${exportParams.toString()}`;
  const excelHref = `${side === "ar" ? path.to.arAgingExcel : path.to.apAgingExcel}?${exportParams.toString()}`;

  const canExpandRow = useCallback(
    (row: WorkbenchRow) =>
      row.kind === "counterparty" &&
      ((childrenByParty[row.partyId]?.length ?? 0) > 0 ||
        (paymentsByParty[row.partyId]?.length ?? 0) > 0),
    [childrenByParty, paymentsByParty]
  );

  const renderExpandedRow = useCallback(
    (row: WorkbenchRow) =>
      row.kind === "counterparty" ? (
        <CounterpartyDocuments
          side={side}
          asOfDate={asOfDate}
          documents={childrenByParty[row.partyId] ?? []}
          payments={paymentsByParty[row.partyId] ?? []}
          selectedIds={selectedIds}
          money={money}
          onSelectDocument={selectDocument}
        />
      ) : null,
    [
      asOfDate,
      childrenByParty,
      money,
      paymentsByParty,
      selectDocument,
      selectedIds,
      side
    ]
  );

  const columns = useMemo<ColumnDef<WorkbenchRow>[]>(() => {
    const allColumns: ColumnDef<WorkbenchRow>[] = [
      {
        id: "Select",
        size: 50,
        minSize: 1,
        header: () => null,
        cell: ({ row }) => {
          const r = row.original;
          if (r.kind === "counterparty") {
            const kids = childrenByParty[r.partyId] ?? [];
            if (kids.length === 0) return null;
            const checked = kids.every((k) => selectedIds.has(k.invoiceId));
            const indeterminate =
              !checked && kids.some((k) => selectedIds.has(k.invoiceId));
            return (
              <IndeterminateCheckbox
                checked={checked}
                indeterminate={indeterminate}
                onChange={(nextChecked, shiftKey) =>
                  selectTreeRow(r, nextChecked, shiftKey)
                }
              />
            );
          }
          return (
            <IndeterminateCheckbox
              checked={selectedIds.has(r.invoiceId)}
              indeterminate={false}
              onChange={(nextChecked, shiftKey) =>
                selectTreeRow(r, nextChecked, shiftKey)
              }
            />
          );
        }
      },
      {
        id: "counterparty",
        header: side === "ar" ? t`Customer` : t`Supplier`,
        cell: ({ row }) => {
          const r = row.original;
          if (r.kind === "counterparty") {
            const kids = childrenByParty[r.partyId] ?? [];
            const isExpanded = expandedIds.has(r.partyId);
            return (
              <div
                data-key-cell=""
                className={cn(
                  "flex items-center max-md:w-[calc(45dvw-32px)]",
                  !reportDetails && "max-md:pl-3"
                )}
              >
                {!reportDetails ? (
                  <div className="w-5 shrink-0 flex items-center justify-center self-center">
                    {kids.length > 0 ? (
                      <button
                        aria-expanded={isExpanded}
                        type="button"
                        aria-label={isExpanded ? t`Collapse` : t`Expand`}
                        className="text-muted-foreground hover:text-foreground max-md:hit-area"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpand(r.partyId);
                        }}
                      >
                        {isExpanded ? (
                          <LuChevronDown className="size-4" />
                        ) : (
                          <LuChevronRight className="size-4" />
                        )}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {r.customerId ? (
                  <CustomerAvatar
                    customerId={r.customerId}
                    className="max-md:min-w-0 max-md:truncate"
                  />
                ) : r.supplierId ? (
                  <SupplierAvatar
                    supplierId={r.supplierId}
                    className="max-md:min-w-0 max-md:truncate"
                  />
                ) : null}
              </div>
            );
          }
          const documentHref =
            r.documentType === "Invoice"
              ? side === "ar"
                ? path.to.salesInvoiceDetails(r.invoiceId)
                : path.to.purchaseInvoiceDetails(r.invoiceId)
              : path.to.memo(r.invoiceId);
          return (
            <div
              data-key-cell=""
              className="flex items-center max-md:w-[calc(45dvw-32px)]"
            >
              <div
                aria-hidden
                className="w-5 shrink-0 border-l border-border -my-2"
              />
              <div className="flex items-center gap-2 pl-2 py-1">
                <Link
                  to={documentHref}
                  className="text-foreground/90 hover:underline"
                >
                  {r.invoiceNumber}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {r.dateDue ? (
                    <DateTime value={r.dateDue} variant="date" />
                  ) : (
                    "—"
                  )}
                </span>
              </div>
            </div>
          );
        },
        meta: {
          icon: <LuUser />,
          mobile: "P1"
        }
      },
      {
        id: "transactionDate",
        header: t`Transaction Date`,
        cell: ({ row }) =>
          row.original.kind === "invoice" && row.original.transactionDate ? (
            <DateTime value={row.original.transactionDate} variant="date" />
          ) : null
      },
      {
        id: "documentType",
        header: t`Type`,
        cell: ({ row }) => {
          const r = row.original;
          if (r.kind !== "invoice") return null;
          if (r.documentType === "Invoice") return t`Invoice`;
          if (r.documentType === "Credit Memo") return t`Credit Memo`;
          if (r.documentType === "Debit Memo") return t`Debit Memo`;
          return r.documentType;
        }
      },
      ...(side === "ap"
        ? [
            {
              id: "supplierReference",
              header: t`Supplier Invoice Number`,
              cell: ({ row }) =>
                row.original.kind === "invoice"
                  ? (row.original.supplierReference ?? "")
                  : null
            } satisfies ColumnDef<WorkbenchRow>
          ]
        : []),
      {
        id: "paymentTerm",
        header: t`Payment Term`,
        cell: ({ row }) =>
          row.original.kind === "counterparty" ? (
            <Enumerable value={row.original.paymentTerm ?? null} />
          ) : null
      },
      {
        id: "originalInBase",
        header: t`Original Amount`,
        cell: ({ row }) =>
          row.original.kind === "invoice" ? (
            <span className="tabular-nums">
              {money(row.original.originalInBase)}
            </span>
          ) : null
      },
      {
        id: "daysPastDue",
        header: t`Days Past Due`,
        cell: ({ row }) => {
          if (row.original.kind !== "invoice") return null;
          return daysPastDue(asOfDate, row.original.dateDue) ?? "—";
        }
      },
      // Aging buckets only carry a value on counterparty rows. They aren't
      // common to both union members, so they use `id` + `cell` (not
      // `accessorKey`) to stay valid against ColumnDef<WorkbenchRow>.
      ...(
        [
          ["current", t`Current`],
          ["bucket1", i18n._(bucketMessages.bucket1)],
          ["bucket2", i18n._(bucketMessages.bucket2)],
          ["bucket3", i18n._(bucketMessages.bucket3)],
          ["bucket4", i18n._(bucketMessages.bucket4)],
          ["unapplied", t`Unapplied`]
        ] as const
      ).map(([key, header]): ColumnDef<WorkbenchRow> => ({
        id: key,
        header,
        cell: ({ row }) =>
          row.original.kind === "counterparty" ? (
            <span className="tabular-nums">{money(row.original[key])}</span>
          ) : null
      })),
      ...(pending
        ? [
            {
              id: "pending",
              header: t`Pending payment, not posted`,
              cell: ({ row }) => {
                const r = row.original;
                const amount =
                  r.kind === "counterparty"
                    ? pendingByParty[r.partyId]
                    : pending[r.invoiceId];
                return amount ? (
                  <span className="tabular-nums text-muted-foreground">
                    {money(amount)}
                  </span>
                ) : null;
              }
            } satisfies ColumnDef<WorkbenchRow>
          ]
        : []),
      {
        id: "total",
        header: t`Total`,
        cell: ({ row }) => {
          const r = row.original;
          const value = r.kind === "counterparty" ? r.total : r.openInBase;
          return (
            <span
              className={cn(
                "tabular-nums",
                r.kind === "counterparty" && "font-semibold"
              )}
            >
              {money(value)}
            </span>
          );
        }
      }
    ];
    return reportDetails
      ? allColumns.filter(
          (column) =>
            ![
              "transactionDate",
              "documentType",
              "supplierReference",
              "originalInBase",
              "daysPastDue"
            ].includes(column.id ?? "")
        )
      : allColumns;
  }, [
    t,
    i18n,
    side,
    bucketMessages.bucket1,
    bucketMessages.bucket2,
    bucketMessages.bucket3,
    bucketMessages.bucket4,
    asOfDate,
    money,
    childrenByParty,
    expandedIds,
    selectedIds,
    reportDetails,
    pending,
    pendingByParty,
    toggleExpand,
    selectTreeRow
  ]);

  const hasVariance = result
    ? Math.abs(result.variance) > VARIANCE_EPSILON
    : false;
  const canAdjust = permissions.has({ "accounting.journalEntries": "Create" });

  const filters = (
    <HStack>
      {result ? (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant={hasVariance ? "destructive" : "secondary"}
              leftIcon={hasVariance ? <LuTriangleAlert /> : <LuScale />}
            >
              <Trans>Tie-Out</Trans>
            </Button>
          </PopoverTrigger>
          <PopoverContent side="bottom" align="end" className="w-80">
            <PopoverHeader>
              <Trans>GL Tie-Out</Trans>
            </PopoverHeader>
            <div className="flex flex-col gap-3 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  <Trans>Subledger</Trans>
                </span>
                <span className="tabular-nums">
                  {money(result.subledgerBalance)}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  <Trans>GL</Trans>
                </span>
                <span className="tabular-nums">{money(result.glBalance)}</span>
              </div>
              <div className="flex items-center justify-between text-sm border-t border-border pt-3">
                <span className="text-muted-foreground">
                  <Trans>Variance</Trans>
                </span>
                <span
                  className={cn(
                    "tabular-nums font-semibold flex items-center gap-1",
                    hasVariance
                      ? "text-red-600 dark:text-red-400"
                      : "text-emerald-600 dark:text-emerald-400"
                  )}
                >
                  {hasVariance ? (
                    <LuTriangleAlert className="size-3.5" />
                  ) : null}
                  {money(result.variance)}
                </span>
              </div>
              {hasVariance && canAdjust ? (
                <adjustFetcher.Form
                  method="post"
                  action={
                    side === "ar"
                      ? path.to.receivablesAdjust
                      : path.to.payablesAdjust
                  }
                >
                  <input type="hidden" name="asOfDate" value={asOfDate} />
                  <Button
                    type="submit"
                    variant="secondary"
                    className="w-full"
                    isLoading={adjustFetcher.state !== "idle"}
                    isDisabled={adjustFetcher.state !== "idle"}
                  >
                    <Trans>Create adjusting entry</Trans>
                  </Button>
                </adjustFetcher.Form>
              ) : null}
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
      {payHref ? (
        <Button asChild variant="primary">
          <Link to={payHref}>
            {side === "ar" ? (
              <Trans>
                Receive Payment · {selectedInvoices.length} invoices
              </Trans>
            ) : (
              <Trans>Make Payment · {selectedInvoices.length} invoices</Trans>
            )}
          </Link>
        </Button>
      ) : selectedInvoices.length > 0 ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="secondary" isDisabled>
              {side === "ar" ? (
                <Trans>Receive Payment</Trans>
              ) : (
                <Trans>Make Payment</Trans>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {!sameParty ? (
              <Trans>Select invoices from a single counterparty</Trans>
            ) : (
              <Trans>Select invoices in a single currency</Trans>
            )}
          </TooltipContent>
        </Tooltip>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" rightIcon={<LuChevronDown />}>
            {agingMethod === "dueDate" ? (
              <Trans>By Due Date</Trans>
            ) : (
              <Trans>By Document Date</Trans>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuRadioGroup value={agingMethod}>
            <DropdownMenuRadioItem
              value="dueDate"
              onClick={() => setParams({ agingMethod: "dueDate" })}
            >
              <Trans>By Due Date</Trans>
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem
              value="documentDate"
              onClick={() => setParams({ agingMethod: "documentDate" })}
            >
              <Trans>By Document Date</Trans>
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="text-sm text-muted-foreground whitespace-nowrap">
        <Trans>As of:</Trans>
      </span>
      <DatePicker
        aria-label={t`As of date`}
        size="sm"
        value={parseDate(asOfDate)}
        onChange={(value) =>
          setParams({ asOfDate: value?.toString() ?? asOfDate })
        }
      />
      {reportDetails ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              leftIcon={<LuDownload />}
              rightIcon={<LuChevronDown />}
            >
              <Trans>Export</Trans>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <a href={exportHref}>
                <Trans>Download CSV</Trans>
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={excelHref}>
                <Trans>Download Excel</Trans>
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </HStack>
  );

  return (
    <VStack spacing={0} className="h-full">
      <div className="flex-1 w-full">
        <Table<WorkbenchRow>
          data={displayRows}
          getRowId={(row) => row.id}
          csvExportHref={exportHref}
          withCsvExport={!reportDetails}
          columns={columns}
          count={displayRows.length}
          renderExpandedRow={reportDetails ? renderExpandedRow : undefined}
          canExpandRow={reportDetails ? canExpandRow : undefined}
          title={title ?? (side === "ar" ? t`Receivables` : t`Payables`)}
          primaryAction={filters}
          defaultColumnPinning={{ left: ["Select", "counterparty"] }}
          mobileLayout="table"
        />
      </div>
    </VStack>
  );
}
