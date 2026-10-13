// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import type {
  ContractDuration,
  contractBillingAlignments,
  contractBillingFrequencies,
  contractBillingTimings,
  contractRenewals,
  customerContractTypes,
  invoiceAutomations
} from "../../sales.models";

type Labels<T extends readonly string[]> = Record<T[number], string>;

/** The translated label of every contract term value, shared by the new
 *  contract form and the properties panel. */
export function useContractLabels() {
  const { t } = useLingui();
  return useMemo(
    () => ({
      contractType: {
        "New Sales": t`New Sales`,
        Existing: t`Existing`,
        Expansion: t`Expansion`,
        Reactivation: t`Reactivation`,
        Contraction: t`Contraction`
      } satisfies Labels<typeof customerContractTypes>,
      duration: {
        "6": t`6 months`,
        "12": t`1 year`,
        "24": t`2 years`,
        "36": t`3 years`,
        open: t`Open-ended`,
        custom: t`Custom`
      } satisfies Record<ContractDuration, string>,
      renewal: {
        Renew: t`Renew`,
        End: t`End`
      } satisfies Labels<typeof contractRenewals>,
      billingFrequency: {
        Week: t`Weekly`,
        Month: t`Monthly`,
        Quarter: t`Quarterly`,
        Year: t`Yearly`
      } satisfies Labels<typeof contractBillingFrequencies>,
      billingAlignment: {
        Anniversary: t`Anniversary`,
        Calendar: t`Calendar`
      } satisfies Labels<typeof contractBillingAlignments>,
      billingTiming: {
        Advance: t`Advance`,
        Arrears: t`Arrears`
      } satisfies Labels<typeof contractBillingTimings>,
      invoiceAutomation: {
        "Draft Only": t`Draft only`,
        Post: t`Post`,
        "Post and Email": t`Post and email`,
        "Post and Send via Stripe": t`Post and send via Stripe`
      } satisfies Labels<typeof invoiceAutomations>
    }),
    [t]
  );
}

/** The duration a stored contract was signed for: its term in months when
 *  that is one of the presets, open-ended with no end date, else custom. */
export function contractDurationOf(contract: {
  endDate: string | null;
  termMonths: number | null;
}): ContractDuration {
  if (!contract.endDate) return "open";
  const months = String(contract.termMonths ?? "");
  return months === "6" || months === "12" || months === "24" || months === "36"
    ? months
    : "custom";
}
