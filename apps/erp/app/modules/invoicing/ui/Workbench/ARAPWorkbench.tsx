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
  Table as TableBase,
  Tbody,
  Td,
  Th,
  Thead,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Tr,
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

type TieOutResult = {
  subledgerBalance: number;
  glBalance: number;
  variance: number;
};

type AgingRow = {
  customerId?: string;
  supplierId?: string;
  paymentTerm?: string | null;
  current: number;
  bucket1: number;
  bucket2: number;
  bucket3: number;
  bucket4: number;
  unapplied: number;
  total: number;
};

type OpenInvoiceRow = {
  invoiceId: string;
  invoiceNumber: string;
  // 'Invoice' | 'Credit Memo' | 'Debit Memo' — from the open-by drill-down
  documentType?: string;
  transactionDate: string | null;
  dateDue: string | null;
  originalInBase: number;
  currencyCode: string;
  exchangeRate: number;
  totalAmount: number;
  settled: number;
  openInCurrency: number;
  openInBase: number;
  customerId?: string;
  supplierId?: string;
  supplierReference?: string | null;
};

type OpenPaymentRow = {
  paymentId: string;
  paymentNumber: string;
  paymentType: string;
  transactionDate: string | null;
  originalInBase: number;
  openInBase: number;
  customerId?: string;
  supplierId?: string;
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

// A counterparty (root) row carries the aging buckets; an invoice (child) row
// carries the open amount. One union type so a single ColumnDef set can render
// both, branching on `kind` — the heterogeneous-tree analogue of the
// StorageUnit tree-table.
type WorkbenchRow =
  | ({ kind: "counterparty"; id: string; partyId: string } & AgingRow)
  | ({ kind: "invoice"; id: string; partyId: string } & OpenInvoiceRow);

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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Selecting a counterparty cascades to all its open invoices; selecting
  // individual invoices is also allowed. Only invoices are selectable — a
  // payment settles invoices, so the counterparty checkbox is purely a
  // select-all-its-children affordance.
  const toggleInvoice = useCallback((invoiceId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(invoiceId)) next.delete(invoiceId);
      else next.add(invoiceId);
      return next;
    });
  }, []);

  const toggleCounterparty = useCallback(
    (partyId: string) => {
      const kids = childrenByParty[partyId] ?? [];
      setSelectedIds((prev) => {
        const next = new Set(prev);
        const allSelected =
          kids.length > 0 && kids.every((k) => next.has(k.invoiceId));
        for (const k of kids) {
          if (allSelected) next.delete(k.invoiceId);
          else next.add(k.invoiceId);
        }
        return next;
      });
    },
    [childrenByParty]
  );

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

  // The selected invoices, and whether they can become one payment. A payment
  // has one counterparty and one currency, so the action is enabled only when
  // the selection is homogeneous on both.
  const { selectedInvoices, sameParty, payHref } = useMemo(() => {
    const selectedInvoices = open.filter((inv) =>
      selectedIds.has(inv.invoiceId)
    );
    const selectedPartyIds = new Set(selectedInvoices.map(partyIdOf));
    const selectedCurrencies = new Set(
      selectedInvoices.map((inv) => inv.currencyCode)
    );
    const sameParty = selectedPartyIds.size === 1;
    const sameCurrency = selectedCurrencies.size === 1;
    const partyId = [...selectedPartyIds][0];
    let payHref: string | null = null;
    if (sameParty && sameCurrency && partyId) {
      const params = new URLSearchParams();
      params.set(side === "ar" ? "customerId" : "supplierId", partyId);
      for (const inv of selectedInvoices)
        params.append("invoiceId", inv.invoiceId);
      payHref = `${path.to.paymentNew}?${params.toString()}`;
    }
    return { selectedInvoices, sameParty, payHref };
  }, [open, selectedIds, partyIdOf, side]);

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
    (row: WorkbenchRow) => {
      if (row.kind !== "counterparty") return null;
      const documents = childrenByParty[row.partyId] ?? [];
      const partyPayments = paymentsByParty[row.partyId] ?? [];
      return (
        <div className="p-3">
          <TableBase className="min-w-[900px]">
            <Thead>
              <Tr>
                <Th className="w-10 px-2" />
                <Th>{t`Document`}</Th>
                <Th>{t`Transaction Date`}</Th>
                <Th>{t`Type`}</Th>
                {side === "ap" ? <Th>{t`Supplier Invoice Number`}</Th> : null}
                <Th>{t`Due Date`}</Th>
                <Th>{t`Original Amount`}</Th>
                <Th>{t`Days Past Due`}</Th>
                <Th>{t`Open Amount`}</Th>
              </Tr>
            </Thead>
            <Tbody>
              {documents.map((document) => {
                const documentHref =
                  document.documentType === "Invoice"
                    ? side === "ar"
                      ? path.to.salesInvoiceDetails(document.invoiceId)
                      : path.to.purchaseInvoiceDetails(document.invoiceId)
                    : path.to.memo(document.invoiceId);
                const documentType =
                  document.documentType === "Invoice"
                    ? t`Invoice`
                    : document.documentType === "Credit Memo"
                      ? t`Credit Memo`
                      : document.documentType === "Debit Memo"
                        ? t`Debit Memo`
                        : document.documentType;
                return (
                  <Tr key={document.invoiceId}>
                    <Td className="px-2">
                      <IndeterminateCheckbox
                        checked={selectedIds.has(document.invoiceId)}
                        indeterminate={false}
                        onChange={() => toggleInvoice(document.invoiceId)}
                      />
                    </Td>
                    <Td>
                      <Link to={documentHref} className="hover:underline">
                        {document.invoiceNumber}
                      </Link>
                    </Td>
                    <Td>
                      {document.transactionDate ? (
                        <DateTime
                          value={document.transactionDate}
                          variant="date"
                        />
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td>{documentType}</Td>
                    {side === "ap" ? (
                      <Td>{document.supplierReference ?? "—"}</Td>
                    ) : null}
                    <Td>
                      {document.dateDue ? (
                        <DateTime value={document.dateDue} variant="date" />
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td className="tabular-nums">
                      {money(document.originalInBase)}
                    </Td>
                    <Td className="tabular-nums">
                      {daysPastDue(asOfDate, document.dateDue) ?? "—"}
                    </Td>
                    <Td className="tabular-nums">
                      {money(document.openInBase)}
                    </Td>
                  </Tr>
                );
              })}
              {partyPayments.map((payment) => (
                <Tr key={payment.paymentId}>
                  <Td />
                  <Td>
                    <Link
                      to={path.to.payment(payment.paymentId)}
                      className="hover:underline"
                    >
                      {payment.paymentNumber}
                    </Link>
                  </Td>
                  <Td>
                    {payment.transactionDate ? (
                      <DateTime
                        value={payment.transactionDate}
                        variant="date"
                      />
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td>
                    {payment.paymentType === "Receipt"
                      ? t`Receipt`
                      : t`Disbursement`}
                  </Td>
                  {side === "ap" ? <Td>—</Td> : null}
                  <Td>—</Td>
                  <Td className="tabular-nums">
                    {money(payment.originalInBase)}
                  </Td>
                  <Td>—</Td>
                  <Td className="tabular-nums">{money(payment.openInBase)}</Td>
                </Tr>
              ))}
            </Tbody>
          </TableBase>
        </div>
      );
    },
    [
      asOfDate,
      childrenByParty,
      money,
      paymentsByParty,
      selectedIds,
      side,
      t,
      toggleInvoice
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
                onChange={() => toggleCounterparty(r.partyId)}
              />
            );
          }
          return (
            <IndeterminateCheckbox
              checked={selectedIds.has(r.invoiceId)}
              indeterminate={false}
              onChange={() => toggleInvoice(r.invoiceId)}
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
    toggleCounterparty,
    toggleInvoice
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
