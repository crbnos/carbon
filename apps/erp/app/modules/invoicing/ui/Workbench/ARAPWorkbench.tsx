import {
  Button,
  cn,
  DatePicker,
  HStack,
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
  LuScale,
  LuTriangleAlert,
  LuUser
} from "react-icons/lu";
import { useFetcher, useNavigate } from "react-router";
import { CustomerAvatar, SupplierAvatar, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { IndeterminateCheckbox } from "~/components/Table/components";
import {
  useCurrencyFormatter,
  useDateFormatter,
  usePermissions,
  useUrlParams
} from "~/hooks";
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
  dateDue: string | null;
  currencyCode: string;
  exchangeRate: number;
  totalAmount: number;
  settled: number;
  openInCurrency: number;
  openInBase: number;
  customerId?: string;
  supplierId?: string;
};

type ARAPWorkbenchProps = {
  side: "ar" | "ap";
  result: TieOutResult | null;
  aging: AgingRow[];
  open: OpenInvoiceRow[];
  asOfDate: string;
  agingMethod: "dueDate" | "documentDate";
  bucketDays: [number, number, number];
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
  asOfDate,
  agingMethod,
  bucketDays
}: ARAPWorkbenchProps) {
  const { t } = useLingui();
  const [, setParams] = useUrlParams();
  const navigate = useNavigate();
  const adjustFetcher = useFetcher();
  const permissions = usePermissions();
  const currencyFormatter = useCurrencyFormatter();
  const { formatDate } = useDateFormatter();
  const [b1, b2, b3] = bucketDays;

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
    for (const a of aging) {
      const pid = partyIdOf(a);
      if (!pid) continue;
      out.push({ kind: "counterparty", id: pid, partyId: pid, ...a });
      if (expandedIds.has(pid)) {
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
  }, [aging, childrenByParty, expandedIds, partyIdOf]);

  // The selected invoices, and whether they can become one payment. A payment
  // has one counterparty and one currency, so the action is enabled only when
  // the selection is homogeneous on both.
  const selectedInvoices = useMemo(
    () => open.filter((inv) => selectedIds.has(inv.invoiceId)),
    [open, selectedIds]
  );
  const selectedPartyIds = useMemo(
    () => new Set(selectedInvoices.map((inv) => partyIdOf(inv))),
    [selectedInvoices, partyIdOf]
  );
  const selectedCurrencies = useMemo(
    () => new Set(selectedInvoices.map((inv) => inv.currencyCode)),
    [selectedInvoices]
  );
  const sameParty = selectedPartyIds.size === 1;
  const sameCurrency = selectedCurrencies.size === 1;
  const canPay = selectedInvoices.length > 0 && sameParty && sameCurrency;

  const payHref = useMemo(() => {
    if (!canPay) return null;
    const pid = [...selectedPartyIds][0];
    if (!pid) return null;
    const params = new URLSearchParams();
    params.set(side === "ar" ? "customerId" : "supplierId", pid);
    for (const inv of selectedInvoices)
      params.append("invoiceId", inv.invoiceId);
    return `${path.to.paymentNew}?${params.toString()}`;
  }, [canPay, selectedPartyIds, selectedInvoices, side]);

  const columns = useMemo<ColumnDef<WorkbenchRow>[]>(() => {
    return [
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
              <div className="flex items-center">
                <div className="w-5 shrink-0 flex items-center justify-center self-center">
                  {kids.length > 0 ? (
                    <button
                      type="button"
                      aria-label={isExpanded ? t`Collapse` : t`Expand`}
                      className="text-muted-foreground hover:text-foreground"
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
                {r.customerId ? (
                  <CustomerAvatar customerId={r.customerId} />
                ) : r.supplierId ? (
                  <SupplierAvatar supplierId={r.supplierId} />
                ) : null}
              </div>
            );
          }
          return (
            <div className="flex items-center">
              <div
                aria-hidden
                className="w-5 shrink-0 border-l border-border -my-2"
              />
              <div className="flex items-center gap-2 pl-2 py-1">
                <span className="text-foreground/90">{r.invoiceNumber}</span>
                <span className="text-xs text-muted-foreground">
                  {r.dateDue ? formatDate(r.dateDue) : "—"}
                </span>
              </div>
            </div>
          );
        },
        meta: { icon: <LuUser /> }
      },
      {
        id: "paymentTerm",
        header: t`Payment Term`,
        cell: ({ row }) =>
          row.original.kind === "counterparty" ? (
            <Enumerable value={row.original.paymentTerm ?? null} />
          ) : null
      },
      // Aging buckets only carry a value on counterparty rows. They aren't
      // common to both union members, so they use `id` + `cell` (not
      // `accessorKey`) to stay valid against ColumnDef<WorkbenchRow>.
      ...(
        [
          ["current", t`Current`],
          ["bucket1", `1-${b1}`],
          ["bucket2", `${b1 + 1}-${b2}`],
          ["bucket3", `${b2 + 1}-${b3}`],
          ["bucket4", `${b3}+`],
          ["unapplied", t`Unapplied`]
        ] as const
      ).map(
        ([key, header]): ColumnDef<WorkbenchRow> => ({
          id: key,
          header,
          cell: ({ row }) =>
            row.original.kind === "counterparty" ? (
              <span className="tabular-nums">{money(row.original[key])}</span>
            ) : null
        })
      ),
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
  }, [
    t,
    side,
    b1,
    b2,
    b3,
    money,
    formatDate,
    childrenByParty,
    expandedIds,
    selectedIds,
    toggleExpand,
    toggleCounterparty,
    toggleInvoice
  ]);

  const hasVariance = result
    ? Math.abs(result.variance) > VARIANCE_EPSILON
    : false;
  const canAdjust = permissions.can("create", "accounting");

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
      {canPay && payHref ? (
        <Button variant="primary" onClick={() => navigate(payHref)}>
          {side === "ar" ? (
            <Trans>Receive Payment · {selectedInvoices.length} invoices</Trans>
          ) : (
            <Trans>Make Payment · {selectedInvoices.length} invoices</Trans>
          )}
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
      <Select
        value={agingMethod}
        onValueChange={(value) => setParams({ agingMethod: value })}
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="dueDate">
            <Trans>By Due Date</Trans>
          </SelectItem>
          <SelectItem value="documentDate">
            <Trans>By Document Date</Trans>
          </SelectItem>
        </SelectContent>
      </Select>
      <span className="text-sm text-muted-foreground whitespace-nowrap">
        <Trans>As of:</Trans>
      </span>
      <DatePicker
        value={parseDate(asOfDate)}
        onChange={(value) =>
          setParams({ asOfDate: value?.toString() ?? asOfDate })
        }
      />
    </HStack>
  );

  return (
    <VStack spacing={0} className="h-full">
      <div className="flex-1 w-full">
        <Table<WorkbenchRow>
          data={displayRows}
          columns={columns}
          count={displayRows.length}
          title={side === "ar" ? t`Receivables` : t`Payables`}
          primaryAction={filters}
          defaultColumnPinning={{ left: ["Select", "counterparty"] }}
        />
      </div>
    </VStack>
  );
}
