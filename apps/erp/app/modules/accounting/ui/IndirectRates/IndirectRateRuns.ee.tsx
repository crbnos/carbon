// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { IndirectRateRun } from "@carbon/ee/indirect-rates";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Tr,
  useDisclosure
} from "@carbon/react";
import { formatPeriodLabel } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useState } from "react";
import { LuPlay, LuRefreshCw } from "react-icons/lu";
import { DateTime, Select } from "~/components";
import { Confirm } from "~/components/Modals";

export type IndirectRateRunRow = IndirectRateRun & {
  accountingPeriod: { startDate: string } | null;
};

export type LockedPeriod = {
  id: string;
  startDate: string;
};

type IndirectRateRunsProps = {
  runs: IndirectRateRunRow[];
  lockedPeriods: LockedPeriod[];
  fiscalYear: number;
  /** Every pool that applies to projects has a Final rate for period 12. */
  canTrueUp: boolean;
  action: string;
  isDisabled: boolean;
};

type RunMode = "run" | "true-up";

/**
 * The period runs of the year (rates, then burden, then billing), with
 * **Run period** and **Run true-up**. Both post into a Locked period.
 */
const IndirectRateRuns = ({
  runs,
  lockedPeriods,
  fiscalYear,
  canTrueUp,
  action,
  isDisabled
}: IndirectRateRunsProps) => {
  const { t } = useLingui();
  const { locale } = useLocale();
  const disclosure = useDisclosure();
  const [mode, setMode] = useState<RunMode>("run");
  const [pickedPeriodId, setPeriodId] = useState<string | null>(null);
  const periodId = pickedPeriodId ?? lockedPeriods[0]?.id ?? "";

  const periodOptions = lockedPeriods.map((period) => ({
    label: formatPeriodLabel(period.startDate, locale),
    value: period.id
  }));
  const hasLockedPeriod = lockedPeriods.length > 0;

  const open = (next: RunMode) => {
    setMode(next);
    disclosure.onOpen();
  };

  const runButton = (
    <Button
      variant="secondary"
      leftIcon={<LuPlay />}
      isDisabled={isDisabled || !hasLockedPeriod}
      onClick={() => open("run")}
    >
      <Trans>Run Period</Trans>
    </Button>
  );

  return (
    <Card>
      <HStack className="items-start justify-between">
        <CardHeader>
          <CardTitle>
            <Trans>Runs</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Each run computes the Actual rates, burdens the projects and bills
              the burden on Cost Plus lines.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardAction>
          <HStack>
            {canTrueUp && (
              <Button
                variant="secondary"
                leftIcon={<LuRefreshCw />}
                isDisabled={isDisabled || !hasLockedPeriod}
                onClick={() => open("true-up")}
              >
                <Trans>Run True-Up</Trans>
              </Button>
            )}
            {hasLockedPeriod ? (
              runButton
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>{runButton}</span>
                </TooltipTrigger>
                <TooltipContent>
                  <Trans>Lock an accounting period first</Trans>
                </TooltipContent>
              </Tooltip>
            )}
          </HStack>
        </CardAction>
      </HStack>
      <CardContent>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <Trans>
              No runs yet. A run starts when a period locks, or with Run Period.
            </Trans>
          </p>
        ) : (
          <div className="w-full overflow-x-auto rounded-lg border border-border">
            <Table full>
              <Thead>
                <Tr>
                  <Th>
                    <Trans>Period</Trans>
                  </Th>
                  <Th>
                    <Trans>Rates</Trans>
                  </Th>
                  <Th>
                    <Trans>Burden</Trans>
                  </Th>
                  <Th>
                    <Trans>Billing</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Burden Rows</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Billable Items</Trans>
                  </Th>
                  <Th>
                    <Trans>Error</Trans>
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {runs.map((run) => (
                  <Tr key={run.id}>
                    <Td className="whitespace-nowrap">
                      {run.accountingPeriod
                        ? formatPeriodLabel(
                            run.accountingPeriod.startDate,
                            locale
                          )
                        : t`FY${run.fiscalYear} P${run.periodNumber}`}
                    </Td>
                    <Td className="whitespace-nowrap">
                      <DateTime value={run.ratesComputedAt} />
                    </Td>
                    <Td className="whitespace-nowrap">
                      <DateTime value={run.burdenComputedAt} />
                    </Td>
                    <Td className="whitespace-nowrap">
                      <DateTime value={run.billingComputedAt} />
                    </Td>
                    <Td className="text-right tabular-nums">
                      {run.burdenRowCount}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {run.billableItemCount}
                    </Td>
                    <Td>
                      {run.error && (
                        <span className="line-clamp-2 text-sm text-destructive">
                          {run.error}
                        </span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        )}
      </CardContent>

      {disclosure.isOpen && (
        <Confirm
          action={action}
          title={mode === "run" ? t`Run Period` : t`Run True-Up`}
          text={
            mode === "run"
              ? t`Compute the Actual rates for the period, post the burden catch-up and bill the burden on Cost Plus lines.`
              : t`Burden fiscal year ${fiscalYear} at its Final rates, post the difference into the period and bill it on Cost Plus lines.`
          }
          confirmText={mode === "run" ? t`Run Period` : t`Run True-Up`}
          onCancel={disclosure.onClose}
          onSubmit={disclosure.onClose}
          details={
            <div className="flex flex-col gap-2 pt-4">
              <span className="text-sm font-medium">
                <Trans>Locked period</Trans>
              </span>
              <Select
                aria-label={t`Locked period`}
                value={periodId}
                options={periodOptions}
                onChange={(value) => setPeriodId(value)}
              />
            </div>
          }
        >
          <input type="hidden" name="intent" value={mode} />
          <input type="hidden" name="accountingPeriodId" value={periodId} />
          <input type="hidden" name="fiscalYear" value={fiscalYear} />
        </Confirm>
      )}
    </Card>
  );
};

export default IndirectRateRuns;
