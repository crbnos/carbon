// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

"use client";

import {
  getClientCache,
  LiveLists,
  LOADER,
  useTableChanges
} from "@carbon/query";
import { useUser } from "~/hooks";
import { customersList } from "~/stores/customers";
import { itemsList } from "~/stores/items";
import { peopleList } from "~/stores/people";
import { suppliersList } from "~/stores/suppliers";
import { path } from "~/utils/path";

// Module-level so their identity is stable across renders.
const LISTS = [itemsList, suppliersList, customersList, peopleList];
// Every location's on-hand entry shares this URL prefix.
const ITEM_QUANTITIES_PATH = path.to.api.itemQuantities("");
const storage = async () => (await import("localforage")).default;

const RealtimeDataProvider = ({ children }: { children: React.ReactNode }) => {
  const {
    company: { id: companyId }
  } = useUser();

  // Quantities are maintained incrementally by triggers on itemLedger, so this
  // fires on the posting itself. Invalidate rather than refetch: the on-hand map
  // is read by the item picker (`useItemQuantities` in `~/components/Form/Item`)
  // and only when one is mounted.
  useTableChanges({
    companyId,
    table: "itemStockQuantities",
    onChange: () => {
      getClientCache()?.invalidateQueries({
        predicate: ({ queryKey }) =>
          queryKey[0] === LOADER &&
          String(queryKey[2]).startsWith(ITEM_QUANTITIES_PATH)
      });
    }
  });

  return (
    <>
      <LiveLists companyId={companyId} lists={LISTS} storage={storage} />
      {children}
    </>
  );
};

export default RealtimeDataProvider;
