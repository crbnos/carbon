// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Card, CardContent, CardHeader, CardTitle } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { ReadOnlyField, ReadOnlyFields } from "~/components";
import {
  useCurrencyFormatter,
  useDateFormatter,
  usePercentFormatter,
  useQuantityFormatter,
  useRouteData
} from "~/hooks";
import { path } from "~/utils/path";
import type {
  contractRateUnits,
  contractRevenueMethods,
  contractRevenueTypes
} from "../../sales.models";
import { isProjectBillingMethod } from "../../sales.models";
import type { getContractLine } from "../../sales.service";
import { useBillingMethodLabels } from "./ContractLineBillingFields";
import type { ContractRouteData } from "./types";

type ContractLineRow = NonNullable<
  Awaited<ReturnType<typeof getContractLine>>["data"]
>;

/**
 * A line of a contract that is no longer a Draft, as text: the fields of
 * `ContractLineForm` with the same labels, and no input boxes. Lines change
 * through Amend, in the contract header.
 */
export default function ContractLineSummary({
  line,
  currencyCode
}: {
  line: ContractLineRow;
  currencyCode: string;
}) {
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const formatMoney = useCurrencyFormatter({ currency: currencyCode });
  const formatRate = useCurrencyFormatter({
    currency: currencyCode,
    rate: true
  });
  const formatPercent = usePercentFormatter();
  const formatQuantity = useQuantityFormatter();
  const routeData = useRouteData<ContractRouteData>(
    path.to.contract(line.customerContractId)
  );
  // "Fixed Price" on a project contract, as its Lines step names it.
  const billingMethodLabels = useBillingMethodLabels(
    routeData?.contract.billingBasis
  );
  const isProject = routeData?.contract.billingBasis === "Project";

  const revenueTypeLabels: Record<
    (typeof contractRevenueTypes)[number],
    string
  > = {
    "One-time": t`One-time`,
    Recurring: t`Recurring`
  };
  const rateUnitLabels: Record<(typeof contractRateUnits)[number], string> = {
    Day: t`Day`,
    Week: t`Week`,
    Month: t`Month`,
    Quarter: t`Quarter`,
    Year: t`Year`
  };
  const revenueMethodLabels: Record<
    (typeof contractRevenueMethods)[number],
    string
  > = {
    Daily: t`Daily`,
    "Even Period": t`Even Period`,
    "Right to Invoice": t`Right to Invoice`,
    "Percent Complete": t`Percent Complete`
  };

  const isBilling = isProjectBillingMethod(line.billingMethod);
  const money = (value: number | null) =>
    value === null ? null : formatMoney.format(Number(value));
  const percent = (fraction: number | null) =>
    fraction === null ? null : formatPercent.format(Number(fraction));
  const date = (value: string | null) => (value ? formatDate(value) : null);
  const parentLine = line.parentLineId
    ? routeData?.lines.find((other) => other.id === line.parentLineId)
    : undefined;
  const billingElement: ReactNode = line.projectElement ? (
    <span className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 whitespace-nowrap">
        {line.projectElement.readableId}
      </span>
      <span className="truncate text-muted-foreground">
        {line.projectElement.name}
      </span>
    </span>
  ) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {line.description || line.item?.name || line.itemId}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ReadOnlyFields>
          <ReadOnlyField label={t`Billing Method`} termId="billing-method">
            {billingMethodLabels[line.billingMethod]}
          </ReadOnlyField>
          <ReadOnlyField label={isProject ? t`Item` : t`Service`}>
            {line.item ? (
              <span className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 whitespace-nowrap">
                  {line.item.readableIdWithRevision ?? line.item.name}
                </span>
                {line.item.name !== line.item.readableIdWithRevision && (
                  <span className="truncate text-muted-foreground">
                    {line.item.name}
                  </span>
                )}
              </span>
            ) : null}
          </ReadOnlyField>
          {!isBilling && (
            <ReadOnlyField label={t`Revenue Type`}>
              {revenueTypeLabels[line.revenueType]}
            </ReadOnlyField>
          )}
          <ReadOnlyField label={t`Description`}>
            {line.description}
          </ReadOnlyField>
          <ReadOnlyField label={t`CLIN / SLIN`} termId="clin">
            {line.lineItemNumber}
          </ReadOnlyField>
          {line.lineItemNumber?.length === 6 && (
            <ReadOnlyField label={t`Parent CLIN`}>
              {parentLine
                ? `${parentLine.lineItemNumber ?? ""} — ${
                    parentLine.description ||
                    parentLine.item?.name ||
                    parentLine.itemId
                  }`
                : null}
            </ReadOnlyField>
          )}
        </ReadOnlyFields>

        <div className="border-t border-border pt-4">
          <ReadOnlyFields>
            {isBilling ? (
              <>
                <ReadOnlyField
                  label={t`Billing Element`}
                  termId="billing-element"
                >
                  {billingElement}
                </ReadOnlyField>
                {line.billingMethod === "Cost Plus" ? (
                  <ReadOnlyField label={t`Fee (%)`}>
                    {percent(line.feePercent)}
                  </ReadOnlyField>
                ) : (
                  <ReadOnlyField label={t`Handling (%)`}>
                    {percent(line.materialHandlingPercent)}
                  </ReadOnlyField>
                )}
                <ReadOnlyField label={t`Funded`}>
                  {money(line.fundedAmount)}
                </ReadOnlyField>
                <ReadOnlyField label={t`Funded Cost`}>
                  {money(line.fundedCost)}
                </ReadOnlyField>
                {line.billingMethod === "Cost Plus" && (
                  <ReadOnlyField label={t`Ceiling`}>
                    {money(line.ceilingAmount)}
                  </ReadOnlyField>
                )}
                <ReadOnlyField label={t`Notice At (%)`}>
                  {percent(line.noticePercent)}
                </ReadOnlyField>
                <ReadOnlyField label={t`Notice Window (Days)`}>
                  {formatQuantity(Number(line.noticeWindowDays))}
                </ReadOnlyField>
              </>
            ) : (
              <>
                <ReadOnlyField label={t`Quantity`}>
                  {formatQuantity(Number(line.quantity))}
                </ReadOnlyField>
                <ReadOnlyField label={t`Rate`}>
                  {formatRate.format(Number(line.rate))}
                  {line.revenueType === "Recurring" && line.rateUnit && (
                    <span className="text-muted-foreground">
                      {" "}
                      / {rateUnitLabels[line.rateUnit]}
                    </span>
                  )}
                </ReadOnlyField>
                <ReadOnlyField label={t`Discount (%)`}>
                  {percent(line.discountPercent)}
                </ReadOnlyField>
                <ReadOnlyField label={t`Discount Ends On`}>
                  {date(line.discountEndsOn)}
                </ReadOnlyField>
              </>
            )}
            <ReadOnlyField label={t`Tax (%)`}>
              {percent(line.taxPercent)}
            </ReadOnlyField>
          </ReadOnlyFields>
        </div>

        <div className="border-t border-border pt-4">
          <ReadOnlyFields>
            <ReadOnlyField label={t`Start Date`}>
              {date(line.startDate)}
            </ReadOnlyField>
            <ReadOnlyField label={t`End Date`}>
              {date(line.endDate)}
            </ReadOnlyField>
            <ReadOnlyField label={t`Go-Live Date`}>
              {date(line.goLiveDate)}
            </ReadOnlyField>
            <ReadOnlyField label={t`Project`}>
              {line.project ? (
                <span className="flex min-w-0 items-center gap-2">
                  {line.project.identifier && (
                    <span className="shrink-0 whitespace-nowrap">
                      {line.project.identifier}
                    </span>
                  )}
                  <span className="truncate text-muted-foreground">
                    {line.project.name}
                  </span>
                </span>
              ) : null}
            </ReadOnlyField>
          </ReadOnlyFields>
        </div>

        <div className="border-t border-border pt-4">
          <ReadOnlyFields>
            <ReadOnlyField label={t`Revenue Method`} termId="revenue-method">
              {revenueMethodLabels[line.revenueMethod]}
            </ReadOnlyField>
            {!isBilling && line.revenueMethod === "Percent Complete" && (
              <ReadOnlyField
                label={t`Billing Element`}
                termId="billing-element"
              >
                {billingElement}
              </ReadOnlyField>
            )}
            <ReadOnlyField label={t`Revenue Start`}>
              {date(line.revenueStartDate)}
            </ReadOnlyField>
            <ReadOnlyField label={t`Revenue End`}>
              {date(line.revenueEndDate)}
            </ReadOnlyField>
          </ReadOnlyFields>
        </div>

        <p className="text-sm text-muted-foreground">
          <Trans>Change lines with Amend.</Trans>
        </p>
      </CardContent>
    </Card>
  );
}
