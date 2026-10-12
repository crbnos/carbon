// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { useCallback } from "react";
import type { LeasePaymentTypeType } from "./types";

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
