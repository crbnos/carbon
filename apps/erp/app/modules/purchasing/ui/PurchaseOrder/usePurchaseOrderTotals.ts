import { atom } from "nanostores";
import { useNanoStore } from "~/hooks";

const $totals = atom<{ total: number }>({
  total: 0,
});
export const usePurchaseOrderTotals = () => useNanoStore($totals);
