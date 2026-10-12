// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { performanceIndexes } from "@carbon/ee/project-control";
import {
  Alert,
  AlertDescription,
  Button,
  cn,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { Fragment } from "react";
import {
  LuChartNoAxesCombined,
  LuDownload,
  LuTriangleAlert
} from "react-icons/lu";
import { useSearchParams } from "react-router";
import { UpgradeOverlaySection } from "~/components/UpgradeOverlay";
import { useCurrencyFormatter, useQuantityFormatter } from "~/hooks";
import { path } from "~/utils/path";

export type EarnedValuePeriodOption = {
  id: string;
  startDate: string;
  endDate: string;
  fiscalYear: number | null;
  periodNumber: number | null;
};

type Values = { bac: number; bcws: number; bcwp: number; acwp: number };

type WorkPackageRow = Values & {
  projectElementId: string;
  readableId: string;
  name: string;
  technique: string;
  controlAccountId: string;
};

type ControlAccountRow = Values & {
  controlAccountId: string;
  readableId: string;
  name: string;
};

/** What the Costs loader returns: the upgrade overlay, or the figures. */
export type EarnedValueData =
  | { gated: true }
  | {
      gated: false;
      /** The Closed period shown, or null for Current. */
      periodId: string | null;
      periods: EarnedValuePeriodOption[];
      workPackages: WorkPackageRow[];
      controlAccounts: ControlAccountRow[];
      warnings: string[];
    };

const NAME_CELL = "min-w-0 flex-1 px-4";
const FIGURE_CELL = "w-24 shrink-0 px-2 text-right tabular-nums";
const CURRENT = "current";

/**
 * Earned value on the Costs tab (Government Contracting 5c): one row per
 * control account with its work packages below it, live or as frozen at a
 * Closed period. A company without government contracting sees the upgrade
 * overlay.
 */
export default function ProjectEarnedValue({
  projectId,
  data
}: {
  projectId: string;
  data: EarnedValueData;
}) {
  if (data.gated) {
    return (
      <UpgradeOverlaySection
        icon={
          <LuChartNoAxesCombined className="size-6 text-muted-foreground" />
        }
        title={<Trans>Earned Value</Trans>}
        description={
          <Trans>Earned value: CPI, SPI and EAC per control account.</Trans>
        }
        className="border-t border-border"
      >
        <EarnedValueTable
          projectId={projectId}
          data={{
            gated: false,
            periodId: null,
            periods: [],
            workPackages: [],
            controlAccounts: [],
            warnings: []
          }}
        />
      </UpgradeOverlaySection>
    );
  }
  return <EarnedValueTable projectId={projectId} data={data} />;
}

function EarnedValueTable({
  projectId,
  data
}: {
  projectId: string;
  data: Extract<EarnedValueData, { gated: false }>;
}) {
  const { t } = useLingui();
  const { locale } = useLocale();
  const [searchParams, setSearchParams] = useSearchParams();
  const formatMoney = useCurrencyFormatter();
  const formatIndex = useQuantityFormatter();

  const money = (value: number) => formatMoney.format(value);
  const index = (value: number | null) =>
    value === null ? "—" : formatIndex(value);

  const periodLabel = (period: EarnedValuePeriodOption) =>
    period.fiscalYear !== null && period.periodNumber !== null
      ? t`FY${period.fiscalYear} P${period.periodNumber}`
      : formatDate(period.endDate, { month: "short", year: "numeric" }, locale);

  const onPeriodChange = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === CURRENT) next.delete("evPeriod");
    else next.set("evPeriod", value);
    setSearchParams(next, { preventScrollReset: true });
  };

  const packagesByAccount = new Map<string, WorkPackageRow[]>();
  for (const pkg of data.workPackages) {
    const list = packagesByAccount.get(pkg.controlAccountId) ?? [];
    list.push(pkg);
    packagesByAccount.set(pkg.controlAccountId, list);
  }

  const figureCells = (values: Values) => {
    const indexes = performanceIndexes(values);
    return (
      <>
        <span className={FIGURE_CELL}>{money(values.bac)}</span>
        <span className={FIGURE_CELL}>{money(values.bcws)}</span>
        <span className={FIGURE_CELL}>{money(values.bcwp)}</span>
        <span className={FIGURE_CELL}>{money(values.acwp)}</span>
        <span className={FIGURE_CELL}>{money(indexes.cv)}</span>
        <span className={FIGURE_CELL}>{money(indexes.sv)}</span>
        <span
          className={cn(
            FIGURE_CELL,
            indexes.cpi !== null && indexes.cpi < 1 && "text-destructive"
          )}
        >
          {index(indexes.cpi)}
        </span>
        <span
          className={cn(
            FIGURE_CELL,
            indexes.spi !== null && indexes.spi < 1 && "text-destructive"
          )}
        >
          {index(indexes.spi)}
        </span>
        <span className={FIGURE_CELL}>{money(indexes.eac)}</span>
        <span className={FIGURE_CELL}>{money(indexes.vac)}</span>
      </>
    );
  };

  return (
    <div className="shrink-0 border-t border-border">
      <div className="flex h-12 items-center gap-2 border-b border-border bg-card px-4 text-sm">
        <span className="min-w-0 flex-1 truncate font-medium">
          <Trans>Earned value</Trans>
        </span>
        {data.periodId && (
          <Button asChild variant="secondary" leftIcon={<LuDownload />}>
            <a
              href={path.to.api.earnedValueAcwpCsv(data.periodId, projectId)}
              download
            >
              <Trans>Export ACWP</Trans>
            </a>
          </Button>
        )}
        <Select value={data.periodId ?? CURRENT} onValueChange={onPeriodChange}>
          <SelectTrigger size="sm" className="w-44 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={CURRENT}>
              <Trans>Current</Trans>
            </SelectItem>
            {data.periods.map((period) => (
              <SelectItem key={period.id} value={period.id}>
                {periodLabel(period)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {data.warnings.length > 0 && (
        <div className="border-b border-border p-4">
          <Alert variant="warning">
            <LuTriangleAlert />
            <AlertDescription>
              <ul className="list-disc pl-4">
                {data.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        </div>
      )}
      <div className="flex h-10 items-center border-b border-border bg-card pr-4 text-xs font-medium text-muted-foreground">
        <div className={NAME_CELL}>
          <Trans>Control account</Trans>
        </div>
        <span className={FIGURE_CELL} title={t`Budget at completion`}>
          <Trans>BAC</Trans>
        </span>
        <span className={FIGURE_CELL} title={t`BCWS`}>
          <Trans>Planned value</Trans>
        </span>
        <span className={FIGURE_CELL} title={t`BCWP`}>
          <Trans>Earned value</Trans>
        </span>
        <span className={FIGURE_CELL} title={t`ACWP`}>
          <Trans>Actual cost</Trans>
        </span>
        <span className={FIGURE_CELL} title={t`Cost variance`}>
          <Trans>CV</Trans>
        </span>
        <span className={FIGURE_CELL} title={t`Schedule variance`}>
          <Trans>SV</Trans>
        </span>
        <span className={FIGURE_CELL} title={t`Cost performance index`}>
          <Trans>CPI</Trans>
        </span>
        <span className={FIGURE_CELL} title={t`Schedule performance index`}>
          <Trans>SPI</Trans>
        </span>
        <span className={FIGURE_CELL} title={t`Estimate at completion`}>
          <Trans>EAC</Trans>
        </span>
        <span className={FIGURE_CELL} title={t`Variance at completion`}>
          <Trans>VAC</Trans>
        </span>
      </div>
      {data.controlAccounts.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">
          {data.periodId ? (
            <Trans>No earned value was recorded for this period.</Trans>
          ) : (
            <Trans>
              No work packages yet. Give a chargeable element below a control
              account an earned value technique.
            </Trans>
          )}
        </p>
      ) : (
        <div className="max-h-96 overflow-y-auto">
          {data.controlAccounts.map((account) => (
            <Fragment key={account.controlAccountId}>
              <div className="flex h-9 items-center border-b border-border bg-muted/40 pr-4 text-sm font-medium">
                <div className={cn(NAME_CELL, "flex items-center gap-2")}>
                  <span className="shrink-0 whitespace-nowrap font-mono text-xs text-muted-foreground">
                    {account.readableId}
                  </span>
                  <span className="truncate">{account.name}</span>
                </div>
                {figureCells(account)}
              </div>
              {(packagesByAccount.get(account.controlAccountId) ?? []).map(
                (pkg) => (
                  <div
                    key={pkg.projectElementId}
                    className="flex h-9 items-center border-b border-border pr-4 text-sm"
                  >
                    <div
                      className={cn(NAME_CELL, "flex items-center gap-2 pl-8")}
                    >
                      <span className="shrink-0 whitespace-nowrap font-mono text-xs text-muted-foreground">
                        {pkg.readableId}
                      </span>
                      <span className="truncate">{pkg.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {pkg.technique}
                      </span>
                    </div>
                    {figureCells(pkg)}
                  </div>
                )
              )}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
