// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { IndirectRateRun } from "@carbon/ee/indirect-rates";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  LabelWithHelp,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useDisclosure
} from "@carbon/react";
import { formatPeriodLabel } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import {
  LuEllipsisVertical,
  LuFileSpreadsheet,
  LuFileText,
  LuPercent,
  LuPlay,
  LuRefreshCw
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { DateTime, Empty, Select, Table } from "~/components";
import { Confirm } from "~/components/Modals";
import { path } from "~/utils/path";

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
  /** The years the fiscal year picker offers, newest first. */
  years: number[];
  onFiscalYearChange: (fiscalYear: string) => void;
  /** Every pool that applies to projects has a Final rate for period 12. */
  canTrueUp: boolean;
  action: string;
  isDisabled: boolean;
};

type RunMode = "run" | "true-up";

/**
 * The Indirect Rates page: the period runs of one fiscal year (rates, then
 * burden, then billing). **Run Period** is the one primary action; the
 * rates, the true-up, the statement and the ICE export are in the ⋯ menu.
 * Both runs post into a Locked period.
 */
const IndirectRateRuns = ({
  runs,
  lockedPeriods,
  fiscalYear,
  years,
  onFiscalYearChange,
  canTrueUp,
  action,
  isDisabled
}: IndirectRateRunsProps) => {
  const { t } = useLingui();
  const { locale } = useLocale();
  const navigate = useNavigate();
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

  const columns = useMemo<ColumnDef<IndirectRateRunRow>[]>(
    () => [
      {
        accessorKey: "periodNumber",
        header: t`Period`,
        cell: ({ row }) => (
          <span className="whitespace-nowrap">
            {row.original.accountingPeriod
              ? formatPeriodLabel(
                  row.original.accountingPeriod.startDate,
                  locale
                )
              : t`FY${row.original.fiscalYear} P${row.original.periodNumber}`}
          </span>
        )
      },
      {
        accessorKey: "ratesComputedAt",
        header: t`Rates`,
        cell: ({ row }) => <DateTime value={row.original.ratesComputedAt} />
      },
      {
        accessorKey: "burdenComputedAt",
        header: () => (
          <LabelWithHelp termId="burden" variant="inline">
            <Trans>Burden</Trans>
          </LabelWithHelp>
        ),
        cell: ({ row }) => <DateTime value={row.original.burdenComputedAt} />
      },
      {
        accessorKey: "billingComputedAt",
        header: t`Billing`,
        cell: ({ row }) => <DateTime value={row.original.billingComputedAt} />
      },
      {
        accessorKey: "burdenRowCount",
        header: t`Burden Rows`,
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.burdenRowCount}</span>
        )
      },
      {
        accessorKey: "billableItemCount",
        header: t`Billable Items`,
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.billableItemCount}</span>
        )
      },
      {
        accessorKey: "error",
        header: t`Error`,
        cell: ({ row }) =>
          row.original.error ? (
            <span className="line-clamp-2 text-sm text-destructive">
              {row.original.error}
            </span>
          ) : null
      }
    ],
    [locale, t]
  );

  const runButton = (
    <Button
      variant="primary"
      leftIcon={<LuPlay />}
      isDisabled={isDisabled || !hasLockedPeriod}
      onClick={() => open("run")}
    >
      <Trans>Run Period</Trans>
    </Button>
  );

  return (
    <>
      <Table<IndirectRateRunRow>
        data={runs}
        columns={columns}
        count={runs.length}
        title={t`Indirect Rates`}
        titleBadge={
          <Select
            aria-label={t`Fiscal year`}
            size="sm"
            value={String(fiscalYear)}
            options={years.map((year) => ({
              label: t`FY${year}`,
              value: String(year)
            }))}
            onChange={onFiscalYearChange}
          />
        }
        primaryAction={
          <HStack>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  aria-label={t`More options`}
                  icon={<LuEllipsisVertical />}
                  variant="secondary"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem
                  onClick={() =>
                    navigate(path.to.indirectRatesRates(fiscalYear))
                  }
                >
                  <DropdownMenuIcon icon={<LuPercent />} />
                  <Trans>Rates</Trans>
                </DropdownMenuItem>
                {canTrueUp && (
                  <DropdownMenuItem
                    disabled={isDisabled || !hasLockedPeriod}
                    onClick={() => open("true-up")}
                  >
                    <DropdownMenuIcon icon={<LuRefreshCw />} />
                    <Trans>Run True-Up</Trans>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() =>
                    navigate(path.to.indirectRatesStatement(fiscalYear))
                  }
                >
                  <DropdownMenuIcon icon={<LuFileText />} />
                  <Trans>Statement</Trans>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => navigate(path.to.indirectRatesIce(fiscalYear))}
                >
                  <DropdownMenuIcon icon={<LuFileSpreadsheet />} />
                  <Trans>ICE Export</Trans>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
        }
        withPagination={false}
        withSearch={false}
        withSimpleSorting={false}
        withColumnOrdering={false}
        withCsvExport={false}
        sort={null}
        emptyState={
          <Empty
            title={<Trans>No runs yet</Trans>}
            description={
              <Trans>
                A run starts when a period locks, or with Run Period. Each run
                computes the Actual rates, burdens the projects and bills the
                burden on Cost Plus lines.
              </Trans>
            }
          />
        }
      />

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
    </>
  );
};

export default IndirectRateRuns;
