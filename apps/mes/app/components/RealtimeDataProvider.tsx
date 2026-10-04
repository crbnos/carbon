// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

"use client";

import { LiveLists } from "@carbon/query";
import { useUser } from "~/hooks";
import { itemsList } from "~/stores/items";
import { peopleList } from "~/stores/people";

// Module-level so their identity is stable across renders.
const LISTS = [itemsList, peopleList];
const storage = async () => (await import("localforage")).default;

const RealtimeDataProvider = ({ children }: { children: React.ReactNode }) => {
  const {
    company: { id: companyId }
  } = useUser();

  return (
    <>
      <LiveLists companyId={companyId} lists={LISTS} storage={storage} />
      {children}
    </>
  );
};

export default RealtimeDataProvider;
