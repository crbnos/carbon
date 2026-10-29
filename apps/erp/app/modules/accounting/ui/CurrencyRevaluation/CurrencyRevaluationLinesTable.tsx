// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { Trans, useLingui } from "@lingui/react/macro";
import { Hyperlink } from "~/components";
import Money from "~/components/Money";
import { useUser } from "~/hooks";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import { path } from "~/utils/path";

type CurrencyRevaluationLine =
  Database["public"]["Tables"]["currencyRevaluationLine"]["Row"];

type CurrencyRevaluationLinesTableProps = {
  lines: CurrencyRevaluationLine[];
};

const gridCols =
  "grid-cols-[170px_1fr_80px_140px_140px_140px_140px] items-center gap-3 px-4";

/** Where a line's document opens, or null when it has no page. */
function documentPath(line: CurrencyRevaluationLine) {
  if (!line.documentId) return null;
  switch (line.documentType) {
    case "Invoice":
      return line.exposureType === "Payable"
        ? path.to.purchaseInvoiceDetails(line.documentId)
        : path.to.salesInvoiceDetails(line.documentId);
    case "Memo":
      return path.to.memo(line.documentId);
    case "Payment":
      return path.to.payment(line.documentId);
    default:
      return null;
  }
}

/** One row per open foreign-currency item: what it is booked at in the base
 *  currency, what it is worth at the run's rate, and the difference (a
 *  positive difference is a gain). */
const CurrencyRevaluationLinesTable = ({
  lines
}: CurrencyRevaluationLinesTableProps) => {
  const { t } = useLingui();
  const { company } = useUser();
  const currencyFormatter = useCurrencyFormatter({
    currency: company.baseCurrencyCode
  });

  const exposureLabels: Record<string, string> = {
    Receivable: t`Receivable`,
    Payable: t`Payable`,
    "Unapplied Receipt": t`Unapplied Receipt`,
    "Unapplied Disbursement": t`Unapplied Disbursement`,
    "Account Balance": t`Account Balance`
  };

  const formatBase = (value: number | null) =>
    value === null ? "—" : currencyFormatter.format(Number(value));

  let gains = 0;
  let losses = 0;
  for (const line of lines) {
    const difference = Number(line.differenceAmount ?? 0);
    if (difference > 0) gains += difference;
    else losses += difference;
  }

  return (
    <div className="rounded-lg border border-border overflow-x-auto w-full">
      <div className="min-w-[960px]">
        {/* Column Headers */}
        <div
          className={`grid ${gridCols} py-2.5 text-sm text-muted-foreground font-medium bg-muted/50 border-b border-border`}
        >
          <div>
            <Trans>Exposure</Trans>
          </div>
          <div>
            <Trans>Document</Trans>
          </div>
          <div>
            <Trans>Currency</Trans>
          </div>
          <div className="text-right">
            <Trans>Open Amount</Trans>
          </div>
          <div className="text-right">
            <Trans>Booked</Trans>
          </div>
          <div className="text-right">
            <Trans>Revalued</Trans>
          </div>
          <div className="text-right">
            <Trans>Difference</Trans>
          </div>
        </div>

        {/* Lines */}
        <div className="divide-y divide-border">
          {lines.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted-foreground text-center">
              <Trans>Nothing to revalue for this period.</Trans>
            </div>
          ) : (
            lines.map((line) => {
              const to = documentPath(line);
              return (
                <div
                  key={line.id}
                  className={`grid ${gridCols} py-2.5 text-sm hover:bg-muted/30 transition-colors`}
                >
                  <div className="min-w-0 truncate">
                    {exposureLabels[line.exposureType] ?? line.exposureType}
                  </div>
                  <div className="min-w-0 truncate">
                    {to ? (
                      <Hyperlink to={to}>
                        {line.documentNumber ?? "—"}
                      </Hyperlink>
                    ) : (
                      (line.documentNumber ?? "—")
                    )}
                  </div>
                  <div>{line.currencyCode}</div>
                  <div className="text-right">
                    <Money
                      value={line.openAmount}
                      currencyCode={line.currencyCode}
                    />
                  </div>
                  <div className="text-right tabular-nums">
                    {formatBase(line.bookedBaseAmount)}
                  </div>
                  <div className="text-right tabular-nums">
                    {formatBase(line.revaluedBaseAmount)}
                  </div>
                  <div className="text-right tabular-nums font-medium">
                    {formatBase(line.differenceAmount)}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Totals */}
        {lines.length > 0 && (
          <div className="bg-muted/50 border-t border-border">
            <div className={`grid ${gridCols} py-2`}>
              <div className="text-sm font-medium">
                <Trans>Total gains</Trans>
              </div>
              <div />
              <div />
              <div />
              <div />
              <div />
              <div className="text-right font-mono text-sm tabular-nums font-medium">
                {currencyFormatter.format(gains)}
              </div>
            </div>
            <div className={`grid ${gridCols} py-2`}>
              <div className="text-sm font-medium">
                <Trans>Total losses</Trans>
              </div>
              <div />
              <div />
              <div />
              <div />
              <div />
              <div className="text-right font-mono text-sm tabular-nums font-medium">
                {currencyFormatter.format(losses)}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CurrencyRevaluationLinesTable;
