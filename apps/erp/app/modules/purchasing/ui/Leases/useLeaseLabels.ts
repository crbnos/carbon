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
