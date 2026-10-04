// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

"use client";

import { LiveLists, useTableChanges } from "@carbon/react";
import { useUser } from "~/hooks";
import { customersList } from "~/stores/customers";
import { itemsList } from "~/stores/items";
import { peopleList } from "~/stores/people";
import { suppliersList } from "~/stores/suppliers";
import { ITEM_QUANTITIES_QUERY_KEY } from "~/utils/react-query";

// Module-level so their identity is stable across renders.
const LISTS = [itemsList, suppliersList, customersList, peopleList];
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
      window.clientCache?.invalidateQueries({
        predicate: (query) =>
          (query.queryKey as unknown[])[0] === ITEM_QUANTITIES_QUERY_KEY
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
