// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Alert, AlertDescription, AlertTitle } from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { LuSparkles } from "react-icons/lu";
import { BillingElement, Number } from "~/components/Form";
import { UpgradeOverlayUpgradeButton } from "~/components/UpgradeOverlay";
import { useCurrencyDecimals } from "~/hooks";
import type { contractBillingMethods } from "../../sales.models";

type BillingMethod = (typeof contractBillingMethods)[number];

export function useBillingMethodLabels() {
  const { t } = useLingui();
  return useMemo<Record<BillingMethod, string>>(
    () => ({
      Fixed: t`Fixed`,
      "Time & Materials": t`Time & Materials`,
      "Cost Plus": t`Cost Plus`
    }),
    [t]
  );
}

/**
 * The terms of a Time & Materials or Cost Plus line, as form fields: the
 * billing element, the handling or fee percent, funding and the funding
 * notice. Rendered inside the caller's grid and `ValidatedForm`; shared by the
 * line form and an amendment's added line.
 */
export function ContractLineBillingFields({
  billingMethod,
  projectId,
  currencyCode,
  fundingOnly = false,
  fundedByActions = false
}: {
  billingMethod: BillingMethod;
  projectId: string;
  currencyCode: string;
  /** Only the funding and notice fields (Edit Funding). */
  fundingOnly?: boolean;
  /** DCAA mode: the funding actions own the funded amount and cost, so
   *  both show read-only. */
  fundedByActions?: boolean;
}) {
  const { t } = useLingui();
  const currencyDecimals = useCurrencyDecimals(currencyCode);
  const money = {
    minValue: 0,
    step: INPUT_STEP.money(currencyDecimals),
    formatOptions: INPUT_FORMAT.money(currencyCode, currencyDecimals)
  };
  const percent = {
    minValue: 0,
    maxValue: 100,
    step: INPUT_STEP.percent,
    formatOptions: INPUT_FORMAT.percentPoints
  };

  return (
    <>
      {!fundingOnly && (
        <>
          <BillingElement
            name="projectElementId"
            projectId={projectId}
            helperText={t`Bills the work charged to this element and the elements below it`}
          />
          {billingMethod === "Cost Plus" ? (
            <Number
              name="feePercent"
              label={t`Fee (%)`}
              helperText={t`Fee on allowable cost`}
              {...percent}
            />
          ) : (
            <Number
              name="materialHandlingPercent"
              label={t`Handling (%)`}
              helperText={t`Markup on material and other direct cost`}
              {...percent}
            />
          )}
        </>
      )}
      <Number
        name="fundedAmount"
        label={t`Funded Amount`}
        helperText={
          fundedByActions
            ? t`Sum of the funding actions`
            : t`Billing stops at this amount`
        }
        isReadOnly={fundedByActions}
        {...money}
      />
      <Number
        name="fundedCost"
        label={t`Funded Cost`}
        helperText={
          fundedByActions
            ? t`Sum of the funding actions`
            : t`Funding without the fee; the funding notices compare cost with it`
        }
        isReadOnly={fundedByActions}
        {...money}
      />
      {billingMethod === "Cost Plus" && (
        <Number name="ceilingAmount" label={t`Ceiling`} {...money} />
      )}
      <Number
        name="noticePercent"
        label={t`Notice At (%)`}
        helperText={t`Of the funded cost, from 75% to 85%`}
        {...percent}
        minValue={75}
        maxValue={85}
      />
      <Number
        name="noticeWindowDays"
        label={t`Notice Window (Days)`}
        helperText={t`Expected cost over the next 30 to 90 days`}
        minValue={30}
        maxValue={90}
      />
    </>
  );
}

/** Cost Plus billing and Percent Complete revenue need the project revenue
 *  feature (`PROJECT_REVENUE`). Shown in place of saving, never instead of
 *  the choice. */
export function ProjectRevenueUpgrade() {
  return (
    <Alert variant="info">
      <LuSparkles />
      <AlertTitle>
        <Trans>Project revenue is not in your plan</Trans>
      </AlertTitle>
      <AlertDescription>
        <div className="flex flex-col items-start gap-2">
          <span>
            <Trans>
              Cost Plus billing and Percent Complete revenue need an upgrade.
              Time & Materials billing and Right to Invoice revenue are
              included.
            </Trans>
          </span>
          <UpgradeOverlayUpgradeButton />
        </div>
      </AlertDescription>
    </Alert>
  );
}
