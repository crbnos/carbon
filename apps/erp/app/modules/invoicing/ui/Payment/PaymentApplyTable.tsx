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
  HStack,
  NumberField,
  NumberInput,
  NumberInputGroup
} from "@carbon/react";
import {
  allocatePaymentFunding,
  EPSILON,
  type FundingSource,
  INPUT_FORMAT,
  round,
  toBaseAmount,
  toDocumentAmount
} from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { CSSProperties } from "react";
import { useCallback, useMemo, useState } from "react";
import { LuListChecks, LuRotateCcw, LuSave } from "react-icons/lu";
import { useFetcher } from "react-router";
import { DateTime } from "~/components";
import {
  useCompanyToday,
  useCurrencyDecimals,
  useCurrencyFormatter,
  usePermissions
} from "~/hooks";
import { path } from "~/utils/path";

// One row in the apply table — an open invoice for the payment's
// counterparty, plus the user's selection + entered amounts.
type OpenInvoice = {
  id: string;
  invoiceId: string;
  dateDue: string | null;
  currencyCode: string;
  exchangeRate: number;
  totalAmount: number;
  balance: number;
  remainingDocument: number;
  status: string | null;
};

type ExistingApplication = {
  sourceAmount: number | null;
  sourcePaymentId?: string | null;
  targetSalesInvoiceId: string | null;
  targetPurchaseInvoiceId: string | null;
  appliedAmount: number;
  discountAmount: number;
  writeOffAmount: number;
  targetExchangeRate: number;
  sourceExchangeRate: number;
  appliedDate: string;
};

// The invoice's read-only fields plus the editable selection state.
type ApplyRow = {
  sourceAmount: number;
  id: string;
  invoiceId: string;
  dateDue: string | null;
  currencyCode: string;
  exchangeRate: number;
  balance: number;
  remainingDocument: number;
  checked: boolean;
  appliedAmount: number;
  discountAmount: number;
  writeOffAmount: number;
};

type AmountField = "appliedAmount" | "discountAmount" | "writeOffAmount";

type PaymentApplyTableProps = {
  paymentId: string;
  paymentType: "Receipt" | "Disbursement";
  paymentCurrency: string;
  baseCurrency: string;
  currencyDecimals: number;
  priorSources: FundingSource[];
  paymentTotal: number;
  paymentExchangeRate: number;
  // On-account credit (in payment currency) the counterparty can draw on when
  // applying more than this payment's cash. 0 when none is available.
  availableCredit: number;
  openInvoices: OpenInvoice[];
  existingApplications: ExistingApplication[];
};

// Shared grid template so the header labels stay aligned with the rows. Wide
// enough to scroll horizontally on small screens rather than cramp the inputs.
const GRID = "grid grid-cols-[2rem_minmax(9rem,1fr)_7rem_8rem_8rem_8rem] gap-3";

// Compact, right-aligned numeric input for the editable amount cells.
const AmountInput = ({
  value,
  onChange,
  isDisabled,
  label,
  currency,
  currencyDecimals
}: {
  value: number;
  onChange: (value: number) => void;
  isDisabled: boolean;
  label: string;
  currency: string;
  currencyDecimals: number;
}) => (
  <NumberField
    aria-label={label}
    value={value}
    onChange={(v) => onChange(Number.isNaN(v) ? 0 : v)}
    minValue={0}
    isDisabled={isDisabled}
    formatOptions={INPUT_FORMAT.money(currency, currencyDecimals)}
  >
    <NumberInputGroup>
      <NumberInput className="text-right tabular-nums" />
    </NumberInputGroup>
  </NumberField>
);

const PaymentApplyTable = ({
  paymentId,
  paymentType,
  paymentCurrency,
  baseCurrency,
  currencyDecimals,
  priorSources,
  paymentTotal,
  paymentExchangeRate,
  availableCredit,
  openInvoices,
  existingApplications
}: PaymentApplyTableProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher();
  const currencyFormatter = useCurrencyFormatter({ currency: paymentCurrency });
  const baseFormatter = useCurrencyFormatter({ currency: baseCurrency });
  const baseDecimals = useCurrencyDecimals(baseCurrency);
  const today = useCompanyToday().toString();
  const isReceipt = paymentType === "Receipt";
  const canEdit = permissions.can("update", "invoicing");
  const seed = useMemo<ApplyRow[]>(() => {
    const byInvoice = new Map<
      string,
      {
        appliedAmount: number;
        discountAmount: number;
        writeOffAmount: number;
        sourceAmount: number;
      }
    >();
    for (const a of existingApplications) {
      const id = isReceipt ? a.targetSalesInvoiceId : a.targetPurchaseInvoiceId;
      if (!id) continue;
      const existing = byInvoice.get(id) ?? {
        appliedAmount: 0,
        discountAmount: 0,
        writeOffAmount: 0,
        sourceAmount: 0
      };
      existing.appliedAmount = round(existing.appliedAmount + a.appliedAmount);
      existing.discountAmount = round(
        existing.discountAmount + a.discountAmount
      );
      existing.writeOffAmount = round(
        existing.writeOffAmount + a.writeOffAmount
      );
      existing.sourceAmount = toDocumentAmount(
        existing.sourceAmount +
          (a.sourceAmount ??
            toDocumentAmount(
              a.appliedAmount,
              a.targetExchangeRate,
              currencyDecimals
            )),
        1,
        currencyDecimals
      );
      byInvoice.set(id, existing);
    }
    return openInvoices
      .filter(
        (inv) =>
          inv.currencyCode === paymentCurrency && inv.remainingDocument > 0
      )
      .map((inv) => ({
        ...inv,
        checked: byInvoice.has(inv.id),
        appliedAmount: 0,
        discountAmount: 0,
        writeOffAmount: 0,
        sourceAmount: 0,
        ...byInvoice.get(inv.id)
      }));
  }, [
    openInvoices,
    existingApplications,
    isReceipt,
    paymentCurrency,
    currencyDecimals
  ]);
  const [rows, setRows] = useState<ApplyRow[]>(seed);
  const currentPayment = useMemo(
    () => ({
      paymentId,
      postingDate: today,
      exchangeRate: paymentExchangeRate,
      remainingDocument: paymentTotal,
      remainingBase: toBaseAmount(paymentTotal, paymentExchangeRate)
    }),
    [paymentId, today, paymentExchangeRate, paymentTotal]
  );
  const preview = useMemo(() => {
    try {
      return {
        data: allocatePaymentFunding({
          currentPayment,
          priorSources,
          currencyDecimals,
          isAR: isReceipt,
          requests: rows
            .filter((r) => r.checked)
            .map((r) => ({
              targetId: r.id,
              targetExchangeRate: r.exchangeRate,
              remainingDocument: r.remainingDocument,
              remainingBase: r.balance,
              requestedDocumentPrincipal: r.sourceAmount,
              discountAmount: r.discountAmount,
              writeOffAmount: r.writeOffAmount
            }))
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
  const maxApplicable = toDocumentAmount(
    paymentTotal + availableCredit,
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
  // post-payment edge function, so a manual discount that over-settles is caught
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
      setRows((prev) => {
        const available = Math.max(
          0,
          toDocumentAmount(
            maxApplicable -
              prev.reduce(
                (sum, r) =>
                  sum + (r.id !== id && r.checked ? r.sourceAmount : 0),
                0
              ),
            1,
            currencyDecimals
          )
        );
        return prev.map((r) => {
          if (r.id !== id) return r;
          if (!checked)
            return {
              ...r,
              checked: false,
              sourceAmount: 0,
              appliedAmount: 0,
              discountAmount: 0,
              writeOffAmount: 0
            };
          const sourceAmount = Math.min(available, r.remainingDocument);
          return {
            ...r,
            checked: true,
            sourceAmount,
            appliedAmount:
              sourceAmount === r.remainingDocument
                ? r.balance
                : Math.min(
                    r.balance,
                    toBaseAmount(sourceAmount, r.exchangeRate)
                  ),
            discountAmount: 0,
            writeOffAmount: 0
          };
        });
      }),
    [maxApplicable, currencyDecimals]
  );
  const updateAmount = useCallback(
    (id: string, field: AmountField, value: number) =>
      setRows((prev) =>
        prev.map((r) => {
          if (r.id !== id) return r;
          const next = { ...r, [field]: round(Math.max(0, value)) };
          if (field === "appliedAmount")
            next.sourceAmount = toDocumentAmount(
              next.appliedAmount,
              r.exchangeRate,
              currencyDecimals
            );
          else if (
            toDocumentAmount(
              r.sourceAmount +
                toDocumentAmount(
                  r.discountAmount + r.writeOffAmount,
                  r.exchangeRate,
                  currencyDecimals
                ),
              1,
              currencyDecimals
            ) === r.remainingDocument
          ) {
            next.appliedAmount = Math.max(
              0,
              round(r.balance - next.discountAmount - next.writeOffAmount)
            );
            next.sourceAmount = Math.max(
              0,
              toDocumentAmount(
                r.remainingDocument -
                  toDocumentAmount(
                    next.discountAmount + next.writeOffAmount,
                    r.exchangeRate,
                    currencyDecimals
                  ),
                1,
                currencyDecimals
              )
            );
          }
          next.checked =
            next.sourceAmount + next.discountAmount + next.writeOffAmount > 0;
          return next;
        })
      ),
    [currencyDecimals]
  );
  const onAutoApply = useCallback(
    () =>
      setRows((prev) => {
        let remaining = maxApplicable;
        const requests = prev.map((r) => {
          const sourceAmount = Math.min(remaining, r.remainingDocument);
          remaining = toDocumentAmount(
            remaining - sourceAmount,
            1,
            currencyDecimals
          );
          return {
            targetId: r.id,
            targetExchangeRate: r.exchangeRate,
            remainingDocument: r.remainingDocument,
            remainingBase: r.balance,
            requestedDocumentPrincipal: sourceAmount,
            discountAmount: 0,
            writeOffAmount: 0
          };
        });
        const result = allocatePaymentFunding({
          currentPayment,
          priorSources,
          requests,
          currencyDecimals,
          isAR: isReceipt
        });
        return prev.map((r) => {
          const apps = result.applications.filter((a) => a.targetId === r.id);
          return {
            ...r,
            checked: apps.length > 0,
            sourceAmount: toDocumentAmount(
              apps.reduce((sum, a) => sum + a.sourceAmount, 0),
              1,
              currencyDecimals
            ),
            appliedAmount: round(
              apps.reduce((sum, a) => sum + a.appliedAmount, 0)
            ),
            discountAmount: 0,
            writeOffAmount: 0
          };
        });
      }),
    [maxApplicable, currentPayment, priorSources, currencyDecimals, isReceipt]
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
    const applications = rows
      .filter(
        (r) =>
          r.checked && r.sourceAmount + r.discountAmount + r.writeOffAmount > 0
      )
      .map((r) => ({
        targetSalesInvoiceId: isReceipt ? r.id : undefined,
        targetPurchaseInvoiceId: isReceipt ? undefined : r.id,
        appliedAmount: r.appliedAmount,
        sourceAmount: r.sourceAmount,
        discountAmount: r.discountAmount,
        writeOffAmount: r.writeOffAmount,
        targetExchangeRate: r.exchangeRate,
        sourceExchangeRate: paymentExchangeRate,
        appliedDate: today
      }));
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
              <Trans>Apply to invoices</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                Applied, discount and write-off amounts are in company base
                currency ({baseCurrency}).
              </Trans>
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
              <Trans>No open invoices</Trans>
            </p>
            <p className="text-sm text-muted-foreground mt-1 text-pretty">
              <Trans>
                This counterparty has nothing outstanding — the payment will be
                recorded on-account.
              </Trans>
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[44rem]">
              <div
                className={cn(GRID, "px-2 pb-2 text-xs text-muted-foreground")}
              >
                <span aria-hidden />
                <span>
                  <Trans>Invoice</Trans>
                </span>
                <span className="text-right">
                  <Trans>Open</Trans>
                </span>
                <span className="text-right">
                  <Trans>Applied</Trans>
                </span>
                <span className="text-right">
                  <Trans>Discount</Trans>
                </span>
                <span className="text-right">
                  <Trans>Write-off</Trans>
                </span>
              </div>
              <div className="border-t border-border/70 divide-y divide-border/70">
                {rows.map((r) => (
                  <div
                    key={r.id}
                    className={cn(
                      GRID,
                      "items-center px-2 py-2 transition-colors",
                      r.checked ? "bg-muted/50" : "hover:bg-muted/30"
                    )}
                  >
                    <div className="flex items-center justify-center">
                      <Checkbox
                        checked={r.checked}
                        onCheckedChange={(checked) =>
                          toggleRow(r.id, Boolean(checked))
                        }
                        disabled={!canEdit}
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-foreground truncate">
                        {r.invoiceId}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {r.dateDue ? (
                          <DateTime value={r.dateDue} variant="date" />
                        ) : (
                          t`No due date`
                        )}
                        {" · "}
                        {r.currencyCode}
                      </div>
                    </div>
                    <div className="text-right tabular-nums text-sm text-muted-foreground self-center">
                      {baseFormatter.format(Number(r.balance))}
                      <div className="text-xs">
                        {currencyFormatter.format(r.remainingDocument)}
                      </div>
                    </div>
                    <AmountInput
                      label={t`Applied amount for ${r.invoiceId}`}
                      value={r.appliedAmount}
                      isDisabled={!canEdit}
                      currency={baseCurrency}
                      currencyDecimals={baseDecimals}
                      onChange={(v) => updateAmount(r.id, "appliedAmount", v)}
                    />
                    <AmountInput
                      label={t`Discount for ${r.invoiceId}`}
                      value={r.discountAmount}
                      isDisabled={!canEdit}
                      currency={baseCurrency}
                      currencyDecimals={baseDecimals}
                      onChange={(v) => updateAmount(r.id, "discountAmount", v)}
                    />
                    <AmountInput
                      label={t`Write-off for ${r.invoiceId}`}
                      value={r.writeOffAmount}
                      isDisabled={!canEdit}
                      currency={baseCurrency}
                      currencyDecimals={baseDecimals}
                      onChange={(v) => updateAmount(r.id, "writeOffAmount", v)}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
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
