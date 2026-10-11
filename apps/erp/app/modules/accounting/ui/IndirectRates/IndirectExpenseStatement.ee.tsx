// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { IndirectPool, IndirectRate } from "@carbon/ee/indirect-rates";
import { cn, Table, Tbody, Td, Th, Thead, Tr } from "@carbon/react";
import { formatQuantity, round } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useCurrencyFormatter, usePercentFormatter } from "~/hooks";

export type IndirectExpenseStatementLine = {
  id: string;
  indirectPoolId: string;
  lineType: string;
  amount: number;
  unallowableAmount: number;
  sourcePoolName: string | null;
  account: { number: string | null; name: string } | null;
};

type IndirectExpenseStatementProps = {
  pools: IndirectPool[];
  lines: IndirectExpenseStatementLine[];
  /** The Actual rate rows of the period: pool cost, base and rate. */
  actualRates: IndirectRate[];
};

const LINE_ORDER: Record<string, number> = {
  Account: 0,
  "Carried Burden": 1,
  "Absorbed Overhead": 2
};

/**
 * The Statement of Indirect Expenses for one period, year to date: each
 * pool's account lines, the burden it carries from earlier pools, its cost,
 * base and rate, and the overhead work centers already applied (B7).
 */
const IndirectExpenseStatement = ({
  pools,
  lines,
  actualRates
}: IndirectExpenseStatementProps) => {
  const { t } = useLingui();
  const { locale } = useLocale();
  const money = useCurrencyFormatter();
  const percent = usePercentFormatter();
  const perHour = useCurrencyFormatter({ rate: true });

  const sections = pools
    .map((pool) => ({
      pool,
      rate: actualRates.find((rate) => rate.indirectPoolId === pool.id),
      lines: lines
        .filter((line) => line.indirectPoolId === pool.id)
        .sort(
          (a, b) =>
            (LINE_ORDER[a.lineType] ?? 0) - (LINE_ORDER[b.lineType] ?? 0) ||
            (a.account?.number ?? "").localeCompare(b.account?.number ?? "")
        )
    }))
    .filter((section) => section.rate || section.lines.length > 0);

  if (sections.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        <Trans>
          No statement for this period. Run the period to compute it.
        </Trans>
      </p>
    );
  }

  return (
    <div className="flex w-full flex-col gap-6">
      {sections.map(({ pool, rate, lines: poolLines }) => {
        const hours = pool.baseType === "Direct Labor Hours";
        const claimedTotal = round(
          poolLines
            .filter((line) => line.lineType !== "Absorbed Overhead")
            .reduce(
              (sum, line) => sum + line.amount - line.unallowableAmount,
              0
            )
        );
        return (
          <section key={pool.id} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium">{pool.name}</h3>
              <span className="text-xs text-muted-foreground">
                {pool.baseType}
              </span>
            </div>
            <div className="w-full overflow-x-auto rounded-lg border border-border">
              <Table full>
                <Thead>
                  <Tr>
                    <Th>
                      <Trans>Account</Trans>
                    </Th>
                    <Th className="text-right">
                      <Trans>Amount</Trans>
                    </Th>
                    <Th className="text-right">
                      <Trans>Unallowable</Trans>
                    </Th>
                    <Th className="text-right">
                      <Trans>Claimed</Trans>
                    </Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {poolLines.map((line) => {
                    const absorbed = line.lineType === "Absorbed Overhead";
                    return (
                      <Tr key={line.id}>
                        <Td>
                          {line.lineType === "Carried Burden" ? (
                            <span className="text-muted-foreground">
                              {t`Burden from ${line.sourcePoolName ?? ""}`}
                            </span>
                          ) : absorbed ? (
                            <div className="flex min-w-0 flex-col">
                              <span>
                                <Trans>Absorbed Overhead</Trans>
                              </span>
                              <span className="text-xs text-muted-foreground">
                                <Trans>Applied by work centers</Trans>
                              </span>
                            </div>
                          ) : (
                            <div className="flex min-w-0 flex-col">
                              <span className="whitespace-nowrap tabular-nums">
                                {line.account?.number}
                              </span>
                              <span className="line-clamp-1 text-xs text-muted-foreground">
                                {line.account?.name}
                              </span>
                            </div>
                          )}
                        </Td>
                        <Td className="whitespace-nowrap text-right tabular-nums">
                          {money.format(absorbed ? -line.amount : line.amount)}
                        </Td>
                        <Td className="whitespace-nowrap text-right tabular-nums">
                          {line.unallowableAmount
                            ? money.format(line.unallowableAmount)
                            : ""}
                        </Td>
                        <Td className="whitespace-nowrap text-right tabular-nums">
                          {absorbed
                            ? ""
                            : money.format(
                                line.amount - line.unallowableAmount
                              )}
                        </Td>
                      </Tr>
                    );
                  })}
                  <Tr className="font-medium">
                    <Td>
                      <Trans>Pool Cost</Trans>
                    </Td>
                    <Td />
                    <Td className="whitespace-nowrap text-right tabular-nums">
                      {rate?.unallowableCost
                        ? money.format(rate.unallowableCost)
                        : ""}
                    </Td>
                    <Td className="whitespace-nowrap text-right tabular-nums">
                      {money.format(rate?.poolCost ?? claimedTotal)}
                    </Td>
                  </Tr>
                  <Tr>
                    <Td>
                      <Trans>Base</Trans>
                    </Td>
                    <Td />
                    <Td />
                    <Td className="whitespace-nowrap text-right tabular-nums">
                      {rate?.baseAmount === null ||
                      rate?.baseAmount === undefined
                        ? ""
                        : hours
                          ? t`${formatQuantity(rate.baseAmount, locale)} h`
                          : money.format(rate.baseAmount)}
                    </Td>
                  </Tr>
                  <Tr className="font-medium">
                    <Td>
                      <Trans>Rate</Trans>
                    </Td>
                    <Td />
                    <Td />
                    <Td
                      className={cn(
                        "whitespace-nowrap text-right tabular-nums",
                        !rate && "text-muted-foreground"
                      )}
                    >
                      {rate
                        ? hours
                          ? t`${perHour.format(rate.ytdRate)}/h`
                          : percent.format(rate.ytdRate)
                        : "–"}
                    </Td>
                  </Tr>
                </Tbody>
              </Table>
            </div>
          </section>
        );
      })}
    </div>
  );
};

export default IndirectExpenseStatement;
