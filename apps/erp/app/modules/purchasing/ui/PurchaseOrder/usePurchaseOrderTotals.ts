// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { create } from "zustand";

type Totals = { total: number };

const useTotals = create<Totals>()(() => ({ total: 0 }));
const setTotals = (totals: Totals) => useTotals.setState(totals, true);

export const usePurchaseOrderTotals = () => [useTotals(), setTotals] as const;
