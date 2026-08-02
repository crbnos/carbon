import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { memo } from "react";
import { useFetcher } from "react-router";
import { Empty } from "~/components";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import type { NettingMatrixRow } from "../../accounting.service";

type NettingMatrixTableProps = {
  data: NettingMatrixRow[];
};

const formatAmount = (amount: number, currencyCode: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode || "USD"
  }).format(amount);

const NettingMatrixTable = memo(({ data }: NettingMatrixTableProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher();
  const canCreate = permissions.can("create", "accounting");

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Netting Matrix</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            Mutual open intercompany balances by company pair and currency.
            Create a netting statement to offset the two directions.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <Empty>
            <span className="text-xs text-muted-foreground">
              {t`No mutual intercompany balances`}
            </span>
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2 font-medium text-muted-foreground">
                    <Trans>Company A</Trans>
                  </th>
                  <th className="text-left p-2 font-medium text-muted-foreground">
                    <Trans>Company B</Trans>
                  </th>
                  <th className="text-left p-2 font-medium text-muted-foreground">
                    <Trans>Currency</Trans>
                  </th>
                  <th className="text-right p-2 font-medium text-muted-foreground">
                    <Trans>A → B</Trans>
                  </th>
                  <th className="text-right p-2 font-medium text-muted-foreground">
                    <Trans>B → A</Trans>
                  </th>
                  <th className="text-right p-2 font-medium text-muted-foreground">
                    <Trans>Netted</Trans>
                  </th>
                  <th className="text-right p-2 font-medium text-muted-foreground">
                    <Trans>Residual</Trans>
                  </th>
                  {canCreate && <th className="p-2" />}
                </tr>
              </thead>
              <tbody>
                {data.map((row) => {
                  const residualPayerName =
                    row.residualPayerCompanyId === row.companyAId
                      ? row.companyAName
                      : row.residualPayerCompanyId === row.companyBId
                        ? row.companyBName
                        : null;
                  return (
                    <tr
                      key={`${row.companyAId}:${row.companyBId}:${row.currencyCode}`}
                      className="border-b"
                    >
                      <td className="p-2 font-medium">{row.companyAName}</td>
                      <td className="p-2 font-medium">{row.companyBName}</td>
                      <td className="p-2">{row.currencyCode}</td>
                      <td className="text-right p-2">
                        {formatAmount(
                          row.grossReceivableAtoB,
                          row.currencyCode
                        )}
                      </td>
                      <td className="text-right p-2">
                        {formatAmount(
                          row.grossReceivableBtoA,
                          row.currencyCode
                        )}
                      </td>
                      <td className="text-right p-2 font-medium">
                        {formatAmount(row.nettedAmount, row.currencyCode)}
                      </td>
                      <td className="text-right p-2">
                        {formatAmount(row.residualAmount, row.currencyCode)}
                        {residualPayerName && row.residualAmount > 0 ? (
                          <span className="text-muted-foreground">
                            {" "}
                            ({residualPayerName})
                          </span>
                        ) : null}
                      </td>
                      {canCreate && (
                        <td className="text-right p-2">
                          <fetcher.Form
                            method="post"
                            action={path.to.newIntercompanyNettingStatement}
                          >
                            <input
                              type="hidden"
                              name="companyAId"
                              value={row.companyAId}
                            />
                            <input
                              type="hidden"
                              name="companyBId"
                              value={row.companyBId}
                            />
                            <input
                              type="hidden"
                              name="currencyCode"
                              value={row.currencyCode}
                            />
                            <Button
                              variant="secondary"
                              size="sm"
                              type="submit"
                              isDisabled={row.nettedAmount <= 0}
                              isLoading={fetcher.state !== "idle"}
                            >
                              <Trans>Create statement</Trans>
                            </Button>
                          </fetcher.Form>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
});

NettingMatrixTable.displayName = "NettingMatrixTable";
export default NettingMatrixTable;
