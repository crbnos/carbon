import { Card, CardContent, CardHeader, CardTitle } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "react-router";
import { DateTime } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useUser } from "~/hooks";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import { path } from "~/utils/path";
import type { getFixedAssetCipCosts } from "../../accounting.service";

export type FixedAssetCipCost = NonNullable<
  Awaited<ReturnType<typeof getFixedAssetCipCosts>>["data"]
>[number];

type FixedAssetCipCostsProps = {
  costs: FixedAssetCipCost[];
  // job row id → readable job number, for the Job source rows
  jobReadableIds: Record<string, string>;
};

const linkClassName = "text-foreground hover:underline";

const FixedAssetCipCosts = ({
  costs,
  jobReadableIds
}: FixedAssetCipCostsProps) => {
  const { t } = useLingui();
  const { company } = useUser();
  const currencyFormatter = useCurrencyFormatter({
    currency: company.baseCurrencyCode
  });

  const total = costs.reduce((sum, cost) => sum + Number(cost.amount), 0);

  const documentLink = (cost: FixedAssetCipCost) => {
    if (cost.jobId) {
      return (
        <Link to={path.to.job(cost.jobId)} className={linkClassName}>
          {jobReadableIds[cost.jobId] ?? cost.jobId}
        </Link>
      );
    }
    if (cost.sourceType === "Receipt" && cost.sourceDocumentId) {
      return (
        <Link
          to={path.to.receipt(cost.sourceDocumentId)}
          className={linkClassName}
        >
          {t`Receipt`}
        </Link>
      );
    }
    if (cost.sourceType === "Purchase Invoice" && cost.sourceDocumentId) {
      return (
        <Link
          to={path.to.purchaseInvoice(cost.sourceDocumentId)}
          className={linkClassName}
        >
          {t`Purchase Invoice`}
        </Link>
      );
    }
    return "—";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Construction in Progress</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {costs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <Trans>No cost has been recorded against this asset yet.</Trans>
          </p>
        ) : (
          <div className="overflow-x-auto -mx-6 px-6">
            <table className="w-full text-base sm:text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2.5 sm:py-2 font-medium text-muted-foreground">
                    <Trans>Date</Trans>
                  </th>
                  <th className="text-left py-2.5 sm:py-2 font-medium text-muted-foreground">
                    <Trans>Source</Trans>
                  </th>
                  <th className="text-left py-2.5 sm:py-2 font-medium text-muted-foreground">
                    <Trans>Document</Trans>
                  </th>
                  <th className="text-left py-2.5 sm:py-2 font-medium text-muted-foreground">
                    <Trans>Journal</Trans>
                  </th>
                  <th className="text-right py-2.5 sm:py-2 font-medium text-muted-foreground">
                    <Trans>Amount</Trans>
                  </th>
                </tr>
              </thead>
              <tbody>
                {costs.map((cost) => (
                  <tr key={cost.id} className="border-b border-border">
                    <td className="py-3 sm:py-2.5">
                      <DateTime
                        value={cost.costDate}
                        variant="date"
                        fallback="—"
                      />
                    </td>
                    <td className="py-3 sm:py-2.5">
                      <Enumerable value={cost.sourceType} />
                    </td>
                    <td className="py-3 sm:py-2.5">{documentLink(cost)}</td>
                    <td className="py-3 sm:py-2.5">
                      {cost.journalId ? (
                        <Link
                          to={path.to.journalEntry(cost.journalId)}
                          className={linkClassName}
                        >
                          <Trans>View</Trans>
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-3 sm:py-2.5 text-right tabular-nums">
                      {currencyFormatter.format(Number(cost.amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td
                    colSpan={4}
                    className="py-3 sm:py-2.5 text-right font-medium"
                  >
                    <Trans>Total</Trans>
                  </td>
                  <td className="py-3 sm:py-2.5 text-right font-medium tabular-nums">
                    {currencyFormatter.format(total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default FixedAssetCipCosts;
