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
import { Trans, useLingui } from "@lingui/react/macro";
import type { CSSProperties } from "react";
import { useCallback, useMemo, useState } from "react";
import { LuListChecks, LuRotateCcw, LuSave } from "react-icons/lu";
import { useFetcher } from "react-router";
import {
  useCurrencyFormatter,
  useDateFormatter,
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
  status: string | null;
};

type ExistingApplication = {
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
  id: string;
  invoiceId: string;
  dateDue: string | null;
  currencyCode: string;
  exchangeRate: number;
  balance: number;
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
  paymentTotal: number;
  paymentExchangeRate: number;
  // On-account credit (in payment currency) the counterparty can draw on when
  // applying more than this payment's cash. 0 when none is available.
  availableCredit: number;
  openInvoices: OpenInvoice[];
  existingApplications: ExistingApplication[];
};

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// Shared grid template so the header labels stay aligned with the rows. Wide
// enough to scroll horizontally on small screens rather than cramp the inputs.
const GRID = "grid grid-cols-[2rem_minmax(9rem,1fr)_7rem_8rem_8rem_8rem] gap-3";

// Compact, right-aligned numeric input for the editable amount cells.
const AmountInput = ({
  value,
  onChange,
  isDisabled,
  label
}: {
  value: number;
  onChange: (value: number) => void;
  isDisabled: boolean;
  label: string;
}) => (
  <NumberField
    aria-label={label}
    value={value}
    onChange={(v) => onChange(Number.isNaN(v) ? 0 : v)}
    minValue={0}
    isDisabled={isDisabled}
    formatOptions={{ minimumFractionDigits: 2, maximumFractionDigits: 4 }}
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
  const { formatDate } = useDateFormatter();
  const today = new Date().toISOString().slice(0, 10);
  const isReceipt = paymentType === "Receipt";
  const canEdit = permissions.can("update", "invoicing");

  // Seed rows from existing applications so users see what's already
  // applied when they reopen a Draft payment.
  const seed = useMemo<ApplyRow[]>(() => {
    const byInvoice = new Map<string, ExistingApplication>();
    for (const a of existingApplications) {
      const id = isReceipt ? a.targetSalesInvoiceId : a.targetPurchaseInvoiceId;
      if (id) byInvoice.set(id, a);
    }
    return openInvoices.map((inv) => {
      const existing = byInvoice.get(inv.id);
      return {
        id: inv.id,
        invoiceId: inv.invoiceId,
        dateDue: inv.dateDue,
        currencyCode: inv.currencyCode,
        exchangeRate: inv.exchangeRate,
        balance: inv.balance,
        checked: Boolean(existing),
        appliedAmount: existing?.appliedAmount ?? 0,
        discountAmount: existing?.discountAmount ?? 0,
        writeOffAmount: existing?.writeOffAmount ?? 0
      };
    });
  }, [openInvoices, existingApplications, isReceipt]);

  const [rows, setRows] = useState<ApplyRow[]>(seed);

  const totalCash = useMemo(
    () => rows.reduce((sum, r) => (r.checked ? sum + r.appliedAmount : sum), 0),
    [rows]
  );
  // The most this payment can apply is its own cash plus the counterparty's
  // available on-account credit; applying beyond cash draws that credit down.
  const maxApplicable = paymentTotal + availableCredit;
  const unapplied = paymentTotal - totalCash;
  const creditDraw = Math.max(
    0,
    Math.min(availableCredit, totalCash - paymentTotal)
  );
  const overApplied = totalCash > maxApplicable + 0.0001;
  const appliedPct =
    paymentTotal > 0
      ? Math.min(100, Math.max(0, (totalCash / paymentTotal) * 100))
      : 0;

  const toggleRow = useCallback(
    (id: string, checked: boolean) =>
      setRows((prev) =>
        prev.map((r) => {
          if (r.id !== id) return r;
          // Checking an empty row auto-fills the applied amount with the
          // open balance (capped at the payment total). Unchecking zeroes it.
          if (checked) {
            return {
              ...r,
              checked: true,
              appliedAmount:
                r.appliedAmount === 0
                  ? round4(Math.min(r.balance, maxApplicable))
                  : r.appliedAmount
            };
          }
          return {
            ...r,
            checked: false,
            appliedAmount: 0,
            discountAmount: 0,
            writeOffAmount: 0
          };
        })
      ),
    [maxApplicable]
  );

  // Entering any amount auto-checks the row so it's included on save (mirrors
  // the check-to-apply affordance).
  const updateAmount = useCallback(
    (id: string, field: AmountField, value: number) =>
      setRows((prev) =>
        prev.map((r) => {
          if (r.id !== id) return r;
          const next = { ...r, [field]: round4(Math.max(0, value)) };
          next.checked =
            next.appliedAmount + next.discountAmount + next.writeOffAmount > 0;
          return next;
        })
      ),
    []
  );

  const onAutoApply = useCallback(() => {
    // Distribute payment cash oldest-first (openInvoices is already sorted by
    // dateDue ascending from the loader).
    let remaining = paymentTotal;
    setRows((prev) =>
      prev.map((r) => {
        if (remaining <= 0) {
          return { ...r, checked: false, appliedAmount: 0 };
        }
        const take = Math.min(remaining, r.balance);
        remaining = round4(remaining - take);
        return { ...r, checked: true, appliedAmount: round4(take) };
      })
    );
  }, [paymentTotal]);

  const onClear = useCallback(
    () =>
      setRows((prev) =>
        prev.map((r) => ({
          ...r,
          checked: false,
          appliedAmount: 0,
          discountAmount: 0,
          writeOffAmount: 0
        }))
      ),
    []
  );

  const onSave = () => {
    const applications = rows
      .filter(
        (r) =>
          r.checked && r.appliedAmount + r.discountAmount + r.writeOffAmount > 0
      )
      .map((r) => ({
        targetSalesInvoiceId: isReceipt ? r.id : undefined,
        targetPurchaseInvoiceId: isReceipt ? undefined : r.id,
        appliedAmount: r.appliedAmount,
        discountAmount: r.discountAmount,
        writeOffAmount: r.writeOffAmount,
        targetExchangeRate: r.exchangeRate || 1,
        sourceExchangeRate: paymentExchangeRate || 1,
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
                Select the invoices this payment settles. Discount and write-off
                are in invoice currency.
              </Trans>
            </CardDescription>
          </div>
          <HStack>
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<LuListChecks />}
              onClick={onAutoApply}
              isDisabled={!canEdit || openInvoices.length === 0}
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
        {openInvoices.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-10 px-6 text-center">
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
                        {r.dateDue ? formatDate(r.dateDue) : t`No due date`}
                        {" · "}
                        {r.currencyCode}
                      </div>
                    </div>
                    <div className="text-right tabular-nums text-sm text-muted-foreground self-center">
                      {currencyFormatter.format(Number(r.balance))}
                    </div>
                    <AmountInput
                      label={t`Applied amount for ${r.invoiceId}`}
                      value={r.appliedAmount}
                      isDisabled={!canEdit}
                      onChange={(v) => updateAmount(r.id, "appliedAmount", v)}
                    />
                    <AmountInput
                      label={t`Discount for ${r.invoiceId}`}
                      value={r.discountAmount}
                      isDisabled={!canEdit}
                      onChange={(v) => updateAmount(r.id, "discountAmount", v)}
                    />
                    <AmountInput
                      label={t`Write-off for ${r.invoiceId}`}
                      value={r.writeOffAmount}
                      isDisabled={!canEdit}
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
        {openInvoices.length > 0 ? (
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
            {availableCredit > 0.0001 ? (
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
        <HStack className="justify-between w-full">
          <span className="text-sm">
            {overApplied ? (
              <span className="font-semibold text-destructive">
                <Trans>Over-applied by</Trans>{" "}
                {currencyFormatter.format(totalCash - maxApplicable)}
              </span>
            ) : creditDraw > 0.0001 ? (
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
            isDisabled={!canEdit || overApplied}
          >
            <Trans>Save applications</Trans>
          </Button>
        </HStack>
      </CardFooter>
    </Card>
  );
};

export default PaymentApplyTable;
