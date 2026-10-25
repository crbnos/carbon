// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  cn,
  HStack
} from "@carbon/react";
import {
  allocatePaymentFunding,
  EPSILON,
  type FundingScope,
  type FundingSource,
  formatDate,
  fundingScopeCovers,
  INPUT_FORMAT,
  round,
  toBaseAmount,
  toDocumentAmount
} from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import type { ColumnDef } from "@tanstack/react-table";
import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuListChecks, LuRotateCcw, LuSave } from "react-icons/lu";
import { useFetcher } from "react-router";
import { EditableNumber } from "~/components/Editable";
import Grid from "~/components/Grid";
import {
  useCompanyToday,
  useCurrencyDecimals,
  useCurrencyFormatter,
  usePermissions
} from "~/hooks";
import { path } from "~/utils/path";
import {
  type AmountField,
  type ApplyRow,
  autoApplyRows,
  buildApplications,
  type ExistingApplication,
  fundingRequests,
  type OpenInvoice,
  seedApplyRows,
  toggleApplyRow,
  updateApplyAmount
} from "./payment-logic";

type PaymentApplyTableProps = {
  isRefund?: boolean;
  // An employee payee: the rows are Posted reimbursements, not invoices, and
  // the only legal target column is `targetReimbursementId`. A reimbursement
  // payout takes no discount and no write-off (there is no negotiated
  // settlement with an employee), so those two columns are hidden as well —
  // `replaceInvoiceSettlements` refuses a non-zero one.
  isReimbursement?: boolean;
  paymentId: string;
  paymentType: "Receipt" | "Disbursement";
  paymentCurrency: string;
  baseCurrency: string;
  currencyDecimals: number;
  // Prior posted receipts this payment can draw on. A source with a `scope` is
  // a customer deposit and funds only invoices of its own document.
  priorSources: FundingSource[];
  // Set when this payment is itself a deposit: it applies only to invoices of
  // that document.
  paymentScope?: FundingScope | null;
  paymentTotal: number;
  paymentExchangeRate: number;
  // On-account credit (in payment currency) the counterparty can draw on when
  // applying more than this payment's cash — deposits excluded, they are
  // listed per document from `priorSources`. 0 when none is available.
  availableCredit: number;
  openInvoices: OpenInvoice[];
  existingApplications: ExistingApplication[];
};

// An amount cell edits local state; Save applications is what persists it, so
// the cell's own "save" always succeeds.
const APPLIED = {
  data: null,
  error: null,
  count: null,
  status: 200,
  statusText: "OK"
} as unknown as PostgrestSingleResponse<unknown>;

// About eight invoices tall; past it the rows scroll under a pinned header and
// only the rows in view are rendered. The grid's layout is then fixed, so each
// column's `size` is its width.
const APPLY_GRID_MAX_HEIGHT = 400;

// Amounts read and edit right-aligned, the way a spreadsheet lines up figures.
const AmountHeader = ({ children }: { children: ReactNode }) => (
  <span className="w-full text-right">{children}</span>
);

const AmountCell = ({ children }: { children: ReactNode }) => (
  <span className="block text-right tabular-nums">{children}</span>
);

const PaymentApplyTable = ({
  isRefund = false,
  isReimbursement = false,
  paymentId,
  paymentType,
  paymentCurrency,
  baseCurrency,
  currencyDecimals,
  priorSources,
  paymentScope = null,
  paymentTotal,
  paymentExchangeRate,
  availableCredit,
  openInvoices,
  existingApplications
}: PaymentApplyTableProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher();
  const { locale } = useLocale();
  const currencyFormatter = useCurrencyFormatter({ currency: paymentCurrency });
  const baseFormatter = useCurrencyFormatter({ currency: baseCurrency });
  const baseDecimals = useCurrencyDecimals(baseCurrency);
  const today = useCompanyToday().toString();
  const isReceipt = paymentType === "Receipt";
  // Discount and write-off only exist on a trade invoice settlement.
  const hasAdjustments = !isRefund && !isReimbursement;
  const canEdit = permissions.can("update", "invoicing");
  const targets = useMemo(
    () => ({ isReceipt, isRefund, isReimbursement }),
    [isReceipt, isRefund, isReimbursement]
  );
  const seed = useMemo<ApplyRow[]>(
    () =>
      seedApplyRows({
        openInvoices,
        existingApplications,
        targets,
        paymentCurrency,
        paymentScope,
        currencyDecimals
      }),
    [
      openInvoices,
      existingApplications,
      targets,
      paymentCurrency,
      paymentScope,
      currencyDecimals
    ]
  );
  const [rows, setRows] = useState<ApplyRow[]>(seed);
  const currentPayment = useMemo(
    () => ({
      paymentId,
      postingDate: today,
      exchangeRate: paymentExchangeRate,
      remainingDocument: paymentTotal,
      remainingBase: toBaseAmount(paymentTotal, paymentExchangeRate),
      scope: paymentScope
    }),
    [paymentId, today, paymentExchangeRate, paymentTotal, paymentScope]
  );
  // Deposits fund only their own document's invoices, so they are not part of
  // the on-account credit any row can draw on.
  const deposits = useMemo(
    () => priorSources.filter((source) => source.scope),
    [priorSources]
  );
  const preview = useMemo(() => {
    try {
      return {
        data: allocatePaymentFunding({
          currentPayment,
          priorSources,
          currencyDecimals,
          isAR: isReceipt,
          requests: fundingRequests(rows)
        }),
        error: null
      };
    } catch (error) {
      return {
        data: null,
        error: error instanceof Error ? error.message : t`Invalid applications`
      };
    }
  }, [rows, currentPayment, priorSources, currencyDecimals, isReceipt, t]);
  const totalCash = toDocumentAmount(
    rows.reduce((sum, r) => sum + (r.checked ? r.sourceAmount : 0), 0),
    1,
    currencyDecimals
  );
  // A deposit counts toward what can be applied only once a row it can fund is
  // selected; whether the selection is actually fundable is the preview's call.
  const eligibleDeposits = deposits.filter((deposit) =>
    rows.some((r) => r.checked && fundingScopeCovers(deposit.scope, r))
  );
  const maxApplicable = toDocumentAmount(
    paymentTotal +
      availableCredit +
      eligibleDeposits.reduce((sum, d) => sum + d.remainingDocument, 0),
    1,
    currencyDecimals
  );
  const unapplied =
    preview.data?.newOnAccountDocument ?? Math.max(0, paymentTotal - totalCash);
  const creditDraw = Math.max(
    0,
    toDocumentAmount(
      totalCash - (paymentTotal - unapplied),
      1,
      currencyDecimals
    )
  );
  // EPSILON, not a hand-picked 1e-4: every amount here is already rounded to
  // internal scale, so the only slack needed is float noise. A 1e-4 band is
  // coarser than the 1e-5 the values carry, and let a real over-application of
  // 0.0001 through.
  const overApplied = totalCash > maxApplicable + EPSILON;
  // A row can't settle more than the invoice's open balance
  // (applied + discount + write-off). Mirrors the authoritative cap in the
  // post-payment server function, so a manual discount that over-settles is caught
  // here — before Post — instead of failing server-side.
  const overSettled = useMemo(
    () =>
      rows.some(
        (r) =>
          r.checked &&
          round(r.appliedAmount + r.discountAmount + r.writeOffAmount) >
            r.balance + EPSILON
      ),
    [rows]
  );
  const appliedPct =
    maxApplicable > 0
      ? Math.min(100, Math.max(0, (totalCash / maxApplicable) * 100))
      : 0;
  const toggleRow = useCallback(
    (id: string, checked: boolean) =>
      setRows((prev) =>
        toggleApplyRow(prev, id, checked, {
          currentPayment,
          priorSources,
          currencyDecimals
        })
      ),
    [currentPayment, priorSources, currencyDecimals]
  );
  const updateAmount = useCallback(
    (id: string, field: AmountField, value: number) =>
      setRows((prev) =>
        updateApplyAmount(prev, id, field, value, currencyDecimals)
      ),
    [currencyDecimals]
  );

  // Each `EditableNumber` call returns a new component, and rebuilding one
  // remounts the open editor mid-typing, so the editors are built once per
  // currency and reach the latest `updateAmount` through a ref.
  const latestUpdateAmount = useRef(updateAmount);
  useEffect(() => {
    latestUpdateAmount.current = updateAmount;
  });
  const editableComponents = useMemo(() => {
    const applyCell = async (
      accessorKey: string,
      value: string,
      row: ApplyRow
    ) => {
      latestUpdateAmount.current(
        row.id,
        accessorKey as AmountField,
        Number(value) || 0
      );
      return APPLIED;
    };
    const editor = EditableNumber<ApplyRow>(
      applyCell,
      {
        minValue: 0,
        formatOptions: INPUT_FORMAT.money(baseCurrency, baseDecimals)
      },
      { inputClassName: "text-right tabular-nums" }
    );
    return {
      appliedAmount: editor,
      discountAmount: editor,
      writeOffAmount: editor
    };
  }, [baseCurrency, baseDecimals]);

  const showsDocumentAmount = paymentCurrency !== baseCurrency;
  const columns = useMemo<ColumnDef<ApplyRow>[]>(() => {
    const amount = (
      accessorKey: AmountField,
      header: string
    ): ColumnDef<ApplyRow> => ({
      accessorKey,
      header: () => <AmountHeader>{header}</AmountHeader>,
      size: 120,
      cell: ({ row }) => (
        <AmountCell>
          {baseFormatter.format(row.original[accessorKey])}
        </AmountCell>
      )
    });

    return [
      {
        id: "select",
        header: "",
        size: 48,
        cell: ({ row }) => (
          <div className="flex items-center justify-center">
            <Checkbox
              aria-label={t`Apply to ${row.original.invoiceId}`}
              checked={row.original.checked}
              onCheckedChange={(checked) =>
                toggleRow(row.original.id, Boolean(checked))
              }
              disabled={!canEdit}
            />
          </div>
        )
      },
      {
        id: "invoice",
        header: isReimbursement
          ? t`Reimbursement`
          : isRefund
            ? t`Memo`
            : t`Invoice`,
        size: 150,
        cell: ({ row }) => (
          <span className="font-medium">{row.original.invoiceId}</span>
        )
      },
      {
        id: "dateDue",
        header: t`Due Date`,
        size: 120,
        cell: ({ row }) => {
          const { dateDue } = row.original;
          if (!dateDue) return "—";
          return (
            <span
              className={cn(
                "tabular-nums",
                // an open invoice due before today is overdue
                dateDue < today && "font-medium text-red-500"
              )}
            >
              {formatDate(dateDue, undefined, locale)}
            </span>
          );
        }
      },
      {
        id: "balance",
        header: () => <AmountHeader>{t`Open`}</AmountHeader>,
        size: 120,
        cell: ({ row }) => (
          <AmountCell>{baseFormatter.format(row.original.balance)}</AmountCell>
        )
      },
      // The same open amount in the payment's own currency, when it differs
      // from the base currency the editable columns are entered in.
      ...(showsDocumentAmount
        ? [
            {
              id: "remainingDocument",
              header: () => (
                <AmountHeader>{t`Open (${paymentCurrency})`}</AmountHeader>
              ),
              size: 120,
              cell: ({ row }) => (
                <AmountCell>
                  {currencyFormatter.format(row.original.remainingDocument)}
                </AmountCell>
              )
            } satisfies ColumnDef<ApplyRow>
          ]
        : []),
      amount("appliedAmount", t`Applied`),
      ...(hasAdjustments
        ? [
            amount("discountAmount", t`Discount`),
            amount("writeOffAmount", t`Write-off`)
          ]
        : [])
    ];
  }, [
    baseFormatter,
    currencyFormatter,
    canEdit,
    hasAdjustments,
    isRefund,
    isReimbursement,
    locale,
    paymentCurrency,
    showsDocumentAmount,
    t,
    today,
    toggleRow
  ]);

  const onAutoApply = useCallback(
    () =>
      setRows((prev) =>
        autoApplyRows(prev, {
          currentPayment,
          priorSources,
          currencyDecimals,
          isReceipt
        })
      ),
    [currentPayment, priorSources, currencyDecimals, isReceipt]
  );
  const onClear = useCallback(
    () =>
      setRows((prev) =>
        prev.map((r) => ({
          ...r,
          checked: false,
          sourceAmount: 0,
          appliedAmount: 0,
          discountAmount: 0,
          writeOffAmount: 0
        }))
      ),
    []
  );
  const onSave = () => {
    if (preview.error) return;
    const applications = buildApplications(rows, {
      targets,
      paymentExchangeRate,
      today
    });
    const formData = new FormData();
    formData.set("applications", JSON.stringify(applications));
    fetcher.submit(formData, {
      method: "post",
      action: path.to.paymentApplicationsSet(paymentId)
    });
  };

  const isSaving = fetcher.state !== "idle";

  return (
    <Card className="w-full">
      <CardHeader>
        <HStack className="justify-between w-full">
          <div>
            <CardTitle>
              {isReimbursement ? (
                <Trans>Apply to reimbursements</Trans>
              ) : isRefund ? (
                <Trans>Refund memos</Trans>
              ) : (
                <Trans>Apply to invoices</Trans>
              )}
            </CardTitle>
            <CardDescription>
              {hasAdjustments ? (
                <Trans>
                  Applied, discount and write-off amounts are in company base
                  currency ({baseCurrency}).
                </Trans>
              ) : (
                <Trans>
                  Applied amounts are in company base currency ({baseCurrency}).
                </Trans>
              )}
            </CardDescription>
          </div>
          <HStack>
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<LuListChecks />}
              onClick={onAutoApply}
              isDisabled={!canEdit || rows.length === 0}
            >
              <Trans>Auto apply</Trans>
            </Button>
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<LuRotateCcw />}
              onClick={onClear}
              isDisabled={!canEdit}
            >
              <Trans>Clear</Trans>
            </Button>
          </HStack>
        </HStack>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-10 px-6 text-center">
            <p className="text-sm font-medium text-foreground">
              {isReimbursement ? (
                <Trans>No open reimbursements</Trans>
              ) : isRefund ? (
                <Trans>No open memos</Trans>
              ) : (
                <Trans>No open invoices</Trans>
              )}
            </p>
            <p className="text-sm text-muted-foreground mt-1 text-pretty">
              <Trans>
                This counterparty has nothing outstanding — the payment will be
                recorded on-account.
              </Trans>
            </p>
          </div>
        ) : (
          <Grid<ApplyRow>
            data={rows}
            columns={columns}
            canEdit={canEdit}
            editableComponents={editableComponents}
            contained={false}
            withSimpleSorting={false}
            maxHeight={APPLY_GRID_MAX_HEIGHT}
          />
        )}
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-4">
        {rows.length > 0 ? (
          <div className="w-full">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-muted-foreground">
                <Trans>Applied</Trans>
              </span>
              <span className="tabular-nums">
                <span
                  className={cn(
                    "font-semibold",
                    overApplied ? "text-destructive" : "text-foreground"
                  )}
                >
                  {currencyFormatter.format(totalCash)}
                </span>
                <span className="text-muted-foreground">
                  {" / "}
                  {currencyFormatter.format(paymentTotal)}
                </span>
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full w-(--applied) transition-[width] duration-300",
                  overApplied ? "bg-destructive" : "bg-primary"
                )}
                style={{ "--applied": `${appliedPct}%` } as CSSProperties}
              />
            </div>
            {availableCredit > 0 ? (
              <div className="mt-2 flex items-baseline justify-between text-xs text-muted-foreground">
                <span>
                  <Trans>On-account credit available</Trans>
                </span>
                <span className="tabular-nums">
                  {currencyFormatter.format(availableCredit)}
                </span>
              </div>
            ) : null}
            {deposits.map((deposit) => {
              const document = deposit.scope?.readableId;
              return (
                <div
                  key={deposit.paymentId}
                  className="mt-1 flex items-baseline justify-between text-xs text-muted-foreground"
                >
                  <span>
                    {document ? (
                      <Trans>Deposit for {document} (its invoices only)</Trans>
                    ) : (
                      <Trans>Deposit (its document's invoices only)</Trans>
                    )}
                  </span>
                  <span className="tabular-nums">
                    {currencyFormatter.format(deposit.remainingDocument)}
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}
        {preview.error ? (
          <p className="text-sm text-destructive">{preview.error}</p>
        ) : null}
        <HStack className="justify-between w-full">
          <span className="text-sm">
            {overSettled ? (
              <span className="font-semibold text-destructive">
                <Trans>
                  A line settles more than its invoice's open balance
                </Trans>
              </span>
            ) : overApplied ? (
              <span className="font-semibold text-destructive">
                <Trans>Over-applied by</Trans>{" "}
                {currencyFormatter.format(totalCash - maxApplicable)}
              </span>
            ) : creditDraw > 0 ? (
              <span className="text-muted-foreground">
                <Trans>Drawing</Trans>{" "}
                <span className="tabular-nums font-medium text-foreground">
                  {currencyFormatter.format(creditDraw)}
                </span>{" "}
                <Trans>from on-account credit</Trans>
              </span>
            ) : (
              <span className="text-muted-foreground">
                <Trans>Unapplied</Trans>{" "}
                <span className="tabular-nums font-medium text-foreground">
                  {currencyFormatter.format(unapplied)}
                </span>
              </span>
            )}
          </span>
          <Button
            leftIcon={<LuSave />}
            onClick={onSave}
            isLoading={isSaving}
            isDisabled={
              !canEdit || overApplied || overSettled || Boolean(preview.error)
            }
          >
            <Trans>Save applications</Trans>
          </Button>
        </HStack>
      </CardFooter>
    </Card>
  );
};

export default PaymentApplyTable;
