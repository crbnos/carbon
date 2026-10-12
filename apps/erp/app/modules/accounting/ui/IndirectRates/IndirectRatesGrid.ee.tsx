// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { TermId } from "@carbon/content/glossary";
import type { IndirectPool, IndirectRate } from "@carbon/ee/indirect-rates";
import { indirectRateTypes } from "@carbon/ee/indirect-rates";
import { LabelWithHelp, Table, Tbody, Td, Th, Thead, Tr } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useMemo } from "react";
import { Enumerable } from "~/components/Enumerable";
import { useCurrencyFormatter, usePercentFormatter } from "~/hooks";

type IndirectRatesGridProps = {
  pools: IndirectPool[];
  rates: IndirectRate[];
  /** The fiscal year's first month, 1–12: names the period columns. */
  startMonth: number;
};

const PERIODS = Array.from({ length: 12 }, (_, i) => i + 1);

/**
 * The YTD rate of every pool and rate type, one column per period of the
 * fiscal year. An hours-base pool's rate is an amount per hour. The cells
 * are narrow so the twelve periods fit the drawer without a sideways scroll.
 */
const IndirectRatesGrid = ({
  pools,
  rates,
  startMonth
}: IndirectRatesGridProps) => {
  const { t } = useLingui();
  const { locale } = useLocale();
  const percentFormatter = usePercentFormatter();
  const perHourFormatter = useCurrencyFormatter({ rate: true });

  const rateByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const rate of rates) {
      map.set(
        `${rate.indirectPoolId}:${rate.rateType}:${rate.periodNumber}`,
        rate.ytdRate
      );
    }
    return map;
  }, [rates]);

  // A period column is named by its calendar month ("Jan" for period 1 of a
  // January year). The year in the date only carries the month.
  const periodLabels = useMemo(
    () =>
      PERIODS.map((periodNumber) => {
        const month = ((startMonth - 1 + periodNumber - 1) % 12) + 1;
        return formatDate(
          `2000-${String(month).padStart(2, "0")}-01`,
          { month: "short" },
          locale
        );
      }),
    [startMonth, locale]
  );

  // The rate types the glossary explains.
  const rateTypeTerms: Partial<Record<string, TermId>> = {
    Provisional: "provisional-rate",
    Final: "final-rate"
  };

  return (
    <>
      {pools.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <Trans>No pools yet. Add one under Indirect Pools.</Trans>
        </p>
      ) : (
        <div className="w-full overflow-x-auto rounded-lg border border-border">
          <Table full>
            <Thead>
              <Tr>
                <Th className="px-4">
                  <LabelWithHelp termId="indirect-pool" variant="inline">
                    <Trans>Pool</Trans>
                  </LabelWithHelp>
                </Th>
                <Th className="px-2">
                  <Trans>Rate Type</Trans>
                </Th>
                {PERIODS.map((periodNumber, i) => (
                  <Th
                    key={periodNumber}
                    className="px-2 text-right"
                    title={t`Period ${periodNumber}`}
                  >
                    {periodLabels[i]}
                  </Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {pools.flatMap((pool) =>
                indirectRateTypes.map((rateType, typeIndex) => {
                  const format = (value: number) =>
                    pool.baseType === "Direct Labor Hours"
                      ? t`${perHourFormatter.format(value)}/h`
                      : percentFormatter.format(value);
                  return (
                    <Tr key={`${pool.id}:${rateType}`}>
                      <Td className="px-4">
                        {typeIndex === 0 && (
                          <div className="flex min-w-0 flex-col">
                            <span className="whitespace-nowrap font-medium">
                              {pool.name}
                            </span>
                            <span className="whitespace-nowrap text-xs text-muted-foreground">
                              {pool.baseType}
                            </span>
                          </div>
                        )}
                      </Td>
                      <Td className="px-2">
                        <LabelWithHelp
                          termId={rateTypeTerms[rateType]}
                          variant="inline"
                        >
                          <Enumerable value={rateType} />
                        </LabelWithHelp>
                      </Td>
                      {PERIODS.map((periodNumber) => {
                        const value = rateByKey.get(
                          `${pool.id}:${rateType}:${periodNumber}`
                        );
                        return (
                          <Td
                            key={periodNumber}
                            className="whitespace-nowrap px-2 text-right tabular-nums"
                          >
                            {value === undefined ? (
                              <span className="text-muted-foreground">–</span>
                            ) : (
                              format(value)
                            )}
                          </Td>
                        );
                      })}
                    </Tr>
                  );
                })
              )}
            </Tbody>
          </Table>
        </div>
      )}
    </>
  );
};

export default IndirectRatesGrid;
