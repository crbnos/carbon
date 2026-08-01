import { Card, CardContent, CardHeader, CardTitle } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { memo, useMemo } from "react";

type BalanceEntry = {
  sourceCompanyId: string;
  sourceCompanyName: string;
  targetCompanyId: string;
  targetCompanyName: string;
  balance: number;
};

type IntercompanyBalanceMatrixProps = {
  data: BalanceEntry[];
};

const IntercompanyBalanceMatrix = memo(
  ({ data }: IntercompanyBalanceMatrixProps) => {
    const { companies, matrix } = useMemo(() => {
      const companyMap = new Map<string, string>();
      for (const entry of data) {
        companyMap.set(entry.sourceCompanyId, entry.sourceCompanyName);
        companyMap.set(entry.targetCompanyId, entry.targetCompanyName);
      }
      const companies = Array.from(companyMap.entries()).map(([id, name]) => ({
        id,
        name
      }));

      const matrix = new Map<string, number>();
      for (const entry of data) {
        matrix.set(
          `${entry.sourceCompanyId}:${entry.targetCompanyId}`,
          Number(entry.balance)
        );
      }

      return { companies, matrix };
    }, [data]);

    if (companies.length === 0) {
      return null;
    }

    const formatAmount = (amount: number) =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      }).format(amount);

    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Intercompany Balances</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2 font-medium text-muted-foreground">
                    <Trans>From / To</Trans>
                  </th>
                  {companies.map((c) => (
                    <th
                      key={c.id}
                      className="text-right p-2 font-medium text-muted-foreground"
                    >
                      {c.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {companies.map((source) => (
                  <tr key={source.id} className="border-b">
                    <td className="p-2 font-medium">{source.name}</td>
                    {companies.map((target) => {
                      const balance =
                        matrix.get(`${source.id}:${target.id}`) ?? 0;
                      const isSelf = source.id === target.id;
                      return (
                        <td
                          key={target.id}
                          className={`text-right p-2 ${
                            isSelf
                              ? "text-muted-foreground"
                              : balance > 0
                                ? "text-foreground"
                                : balance < 0
                                  ? "text-destructive"
                                  : "text-muted-foreground"
                          }`}
                        >
                          {isSelf ? "—" : formatAmount(balance)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    );
  }
);

IntercompanyBalanceMatrix.displayName = "IntercompanyBalanceMatrix";
export default IntercompanyBalanceMatrix;
