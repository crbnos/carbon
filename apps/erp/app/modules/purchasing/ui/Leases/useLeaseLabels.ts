// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { LeasePaymentFrequency, LesseeLegAccount } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { useCallback } from "react";
import type { LeasePaymentTypeType } from "./types";

/** A payment frequency on screen: its name ("Quarterly"), or how often an
 *  amount is paid ("per quarter"). */
export function useLeaseFrequencyLabel() {
  const { t } = useLingui();
  return useCallback(
    (
      frequency: LeasePaymentFrequency | string | null | undefined,
      form: "name" | "per" = "name"
    ) => {
      switch (frequency) {
        case "Quarterly":
          return form === "per" ? t`per quarter` : t`Quarterly`;
        case "Annual":
          return form === "per" ? t`per year` : t`Annual`;
        default:
          return form === "per" ? t`per month` : t`Monthly`;
      }
    },
    [t]
  );
}

/** The account a lifecycle journal's leg posts to, on screen. The gain or
 *  loss is named for the action that books it. */
export function useLeaseLegLabel() {
  const { t } = useLingui();
  return useCallback(
    (
      account: LesseeLegAccount,
      action: "modification" | "termination" | "other" = "other"
    ) => {
      switch (account) {
        case "rightOfUseAsset":
          return t`Right-of-Use Asset`;
        case "accumulatedRightOfUseAmortization":
          return t`Accumulated ROU Amortization`;
        case "leaseLiability":
          return t`Lease Liability`;
        case "fixedAsset":
          return t`Fixed Asset`;
        case "retainedEarnings":
          return t`Retained Earnings`;
        case "loss":
          return t`Loss on Lease Termination`;
        case "gain":
          return action === "modification"
            ? t`Gain on Lease Modification`
            : t`Gain on Lease Termination`;
      }
    },
    [t]
  );
}

/** A payment row's type on screen. */
export function useLeasePaymentTypeLabel() {
  const { t } = useLingui();
  return useCallback(
    (value: LeasePaymentTypeType | string) => {
      switch (value) {
        case "Purchase Option":
          return t`Purchase Option`;
        case "Termination Penalty":
          return t`Termination Penalty`;
        default:
          return t`Rent`;
      }
    },
    [t]
  );
}

/** What the Activate dialog says activating does. An open-ended lease is
 *  short-term, so it books nothing and its rows are cut as periods come due. */
export function useLeaseActivateText() {
  const { t } = useLingui();
  return useCallback(
    (lease: { endDate: string | null }) =>
      lease.endDate
        ? t`Activating classifies each asset, books its right-of-use asset and lease liability, and writes its monthly schedule. The terms and payment rows are fixed afterwards.`
        : t`Activating fixes the terms. The next payment row is cut as each period comes due.`,
    [t]
  );
}
