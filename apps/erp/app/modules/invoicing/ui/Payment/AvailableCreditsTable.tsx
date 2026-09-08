import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  cn,
  NumberField,
  NumberInput,
  NumberInputGroup,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@carbon/react";
import {
  INPUT_FORMAT,
  round,
  toBaseAmount,
  toDocumentAmount
} from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useMemo, useState } from "react";
import { LuSave } from "react-icons/lu";
import { useFetcher } from "react-router";
import { Enumerable } from "~/components/Enumerable";
import {
  useCurrencyDecimals,
  useCurrencyFormatter,
  usePermissions
} from "~/hooks";
import { path } from "~/utils/path";

// An available credit (a posted, balance-reducing memo) the party can apply to an
// open invoice alongside the cash payment.
type AvailableCredit = {
  id: string;
  memoId: string;
  direction: string;
  currencyCode: string;
  exchangeRate: number;
  remaining: number;
  remainingDocument: number;
};

type OpenInvoiceOption = {
  id: string;
  invoiceId: string;
  exchangeRate: number;
  balance: number;
  remainingDocument: number;
};

type AvailableCreditsTableProps = {
  paymentId: string;
  // Drives which invoice column the settlement targets.
  side: "sales" | "purchase";
  currency: string;
  documentCurrency: string;
  documentDecimals: number;
  credits: AvailableCredit[];
  openInvoices: OpenInvoiceOption[];
  // Credit applications already staged on this (Draft) payment — pre-fills the
  // table so a staged credit shows as selected instead of vanishing.
  staged?: {
    memoId: string;
    invoiceId: string;
    amount: number;
    sourceAmount?: number | null;
  }[];
};

type CreditRow = {
  id: string;
  memoId: string;
  direction: string;
  remaining: number;
  remainingDocument: number;
  checked: boolean;
  invoiceId: string; // target invoice id
  amount: number;
  sourceAmount: number;
  exchangeRate: number;
};

const GRID =
  "grid grid-cols-[2rem_minmax(8rem,1fr)_7rem_minmax(9rem,1fr)_8rem] gap-3";

const AvailableCreditsTable = ({
  paymentId,
  side,
  currency,
  documentCurrency,
  documentDecimals,
  credits,
  openInvoices,
  staged = []
}: AvailableCreditsTableProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher();
  const currencyFormatter = useCurrencyFormatter({ currency });
  const documentFormatter = useCurrencyFormatter({
    currency: documentCurrency
  });
  const currencyDecimals = useCurrencyDecimals(currency);
  const canEdit = permissions.can("update", "invoicing");

  const balanceByInvoice = useMemo(
    () => new Map(openInvoices.map((i) => [i.id, i])),
    [openInvoices]
  );

  // staged is keyed by the memo's row id (== credit.id).
  const stagedByMemo = useMemo(
    () => new Map(staged.map((s) => [s.memoId, s])),
    [staged]
  );
  const seed = useMemo<CreditRow[]>(
    () =>
      credits.map((c) => {
        const s = stagedByMemo.get(c.id);
        return {
          id: c.id,
          memoId: c.memoId,
          direction: c.direction,
          remaining: c.remaining,
          remainingDocument: c.remainingDocument,
          exchangeRate: c.exchangeRate,
          checked: Boolean(s),
          invoiceId:
            s?.invoiceId ??
            openInvoices.find((i) => i.exchangeRate === c.exchangeRate)?.id ??
            "",
          amount: s?.amount ?? 0,
          sourceAmount:
            s?.sourceAmount ??
            (s
              ? toDocumentAmount(s.amount, c.exchangeRate, documentDecimals)
              : 0)
        };
      }),
    [credits, openInvoices, stagedByMemo, documentDecimals]
  );

  const [rows, setRows] = useState<CreditRow[]>(seed);

  const capFor = useCallback(
    (row: CreditRow, invoiceId: string) => {
      const invoice = balanceByInvoice.get(invoiceId);
      if (!invoice || invoice.exchangeRate !== row.exchangeRate)
        return { amount: 0, sourceAmount: 0 };
      const sourceAmount = Math.min(
        row.remainingDocument,
        invoice.remainingDocument
      );
      const amount =
        sourceAmount === invoice.remainingDocument
          ? invoice.balance
          : sourceAmount === row.remainingDocument
            ? row.remaining
            : toBaseAmount(sourceAmount, row.exchangeRate);
      return { amount, sourceAmount };
    },
    [balanceByInvoice]
  );
  const toggleRow = useCallback(
    (id: string, checked: boolean) =>
      setRows((prev) =>
        prev.map((r) =>
          r.id !== id
            ? r
            : {
                ...r,
                checked,
                ...(checked
                  ? capFor(r, r.invoiceId)
                  : { amount: 0, sourceAmount: 0 })
              }
        )
      ),
    [capFor]
  );
  const updateInvoice = useCallback(
    (id: string, invoiceId: string) =>
      setRows((prev) =>
        prev.map((r) =>
          r.id !== id
            ? r
            : { ...r, invoiceId, ...(r.checked ? capFor(r, invoiceId) : {}) }
        )
      ),
    [capFor]
  );
  const updateAmount = useCallback(
    (id: string, value: number) =>
      setRows((prev) =>
        prev.map((r) => {
          if (r.id !== id) return r;
          const amount = round(Math.max(0, value));
          const cap = capFor(r, r.invoiceId);
          const sourceAmount =
            amount === cap.amount
              ? cap.sourceAmount
              : toDocumentAmount(amount, r.exchangeRate, documentDecimals);
          return { ...r, amount, sourceAmount, checked: sourceAmount > 0 };
        })
      ),
    [capFor, documentDecimals]
  );

  const totalApplied = useMemo(
    () => rows.reduce((sum, r) => (r.checked ? sum + r.amount : sum), 0),
    [rows]
  );

  const onSave = () => {
    const applications = rows
      .filter((r) => r.checked && r.sourceAmount > 0 && r.invoiceId)
      .map((r) => ({
        memoId: r.id,
        invoiceId: r.invoiceId,
        amount: r.amount,
        sourceAmount: r.sourceAmount
      }));

    const formData = new FormData();
    formData.set("applications", JSON.stringify(applications));
    fetcher.submit(formData, {
      method: "post",
      action: path.to.paymentCreditsSet(paymentId)
    });
  };

  const isSaving = fetcher.state !== "idle";

  if (credits.length === 0) return null;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>
          <Trans>Apply available credits</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            Credit amounts are in company base currency ({currency}). Credits
            take effect when this payment posts.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {openInvoices.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-10 px-6 text-center">
            <p className="text-sm font-medium text-foreground">
              <Trans>No open invoices</Trans>
            </p>
            <p className="text-sm text-muted-foreground mt-1 text-pretty">
              <Trans>
                There's nothing outstanding to apply these credits to.
              </Trans>
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[40rem]">
              <div
                className={cn(GRID, "px-2 pb-2 text-xs text-muted-foreground")}
              >
                <span aria-hidden />
                <span>
                  <Trans>Credit</Trans>
                </span>
                <span className="text-right">
                  <Trans>Remaining</Trans>
                </span>
                <span>
                  <Trans>Apply to invoice</Trans>
                </span>
                <span className="text-right">
                  <Trans>Amount</Trans>
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
                        {r.memoId}
                      </div>
                      <div className="mt-0.5">
                        <Enumerable value={r.direction} />
                      </div>
                    </div>
                    <div className="text-right tabular-nums text-sm text-muted-foreground self-center">
                      {currencyFormatter.format(Number(r.remaining))}
                      <div className="text-xs">
                        {documentFormatter.format(r.remainingDocument)}
                      </div>
                    </div>
                    <Select
                      value={r.invoiceId}
                      onValueChange={(v) => updateInvoice(r.id, v)}
                    >
                      <SelectTrigger size="sm">
                        <SelectValue placeholder={t`Select invoice`} />
                      </SelectTrigger>
                      <SelectContent>
                        {openInvoices
                          .filter((inv) => inv.exchangeRate === r.exchangeRate)
                          .map((inv) => (
                            <SelectItem key={inv.id} value={inv.id}>
                              {inv.invoiceId}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <NumberField
                      aria-label={t`Amount to apply for ${r.memoId}`}
                      value={r.amount}
                      onChange={(v) =>
                        updateAmount(r.id, Number.isNaN(v) ? 0 : v)
                      }
                      minValue={0}
                      isDisabled={!canEdit}
                      formatOptions={INPUT_FORMAT.money(
                        currency,
                        currencyDecimals
                      )}
                    >
                      <NumberInputGroup>
                        <NumberInput className="text-right tabular-nums" />
                      </NumberInputGroup>
                    </NumberField>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
      {openInvoices.length > 0 ? (
        <CardFooterRow
          totalApplied={totalApplied}
          format={currencyFormatter.format}
          onSave={onSave}
          isSaving={isSaving}
          canEdit={canEdit}
        />
      ) : null}
    </Card>
  );
};

// Small footer so the Card import list stays tidy.
const CardFooterRow = ({
  totalApplied,
  format,
  onSave,
  isSaving,
  canEdit
}: {
  totalApplied: number;
  format: (n: number) => string;
  onSave: () => void;
  isSaving: boolean;
  canEdit: boolean;
}) => (
  <div className="flex items-center justify-between gap-4 px-6 pt-4 pb-6">
    <span className="text-sm text-muted-foreground">
      <Trans>Credits applied</Trans>{" "}
      <span className="tabular-nums font-medium text-foreground">
        {format(totalApplied)}
      </span>
    </span>
    <Button
      leftIcon={<LuSave />}
      onClick={onSave}
      isLoading={isSaving}
      isDisabled={!canEdit}
    >
      <Trans>Apply credits</Trans>
    </Button>
  </div>
);

export default AvailableCreditsTable;
