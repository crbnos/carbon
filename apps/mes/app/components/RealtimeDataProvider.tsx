// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

"use client";

import { LiveLists } from "@carbon/query";
import { useRouteData } from "@carbon/react";
import { useMemo } from "react";
import { useUser } from "~/hooks";
import { itemsList } from "~/stores/items";
import { peopleList } from "~/stores/people";
import { path } from "~/utils/path";

// Module-level so their identity is stable across renders.
const LISTS = [itemsList, peopleList];
const storage = async () => (await import("localforage")).default;

const RealtimeDataProvider = ({ children }: { children: React.ReactNode }) => {
  const {
    id: userId,
    company: { id: companyId }
  } = useUser();
  const shell = useRouteData<{
    companies: { companyId: string | null; role: string | null }[];
  }>(path.to.authenticatedRoot);
  // The companies this user works in. Lists stored for any other are removed
  // from the device when the page loads (see `LiveLists`).
  const companyIds = useMemo(
    () =>
      (shell?.companies ?? []).flatMap((company) =>
        company.role === "employee" && company.companyId
          ? [company.companyId]
          : []
      ),
    [shell?.companies]
  );

  return (
    <>
      <LiveLists
        companyId={companyId}
        userId={userId}
        companyIds={companyIds}
        lists={LISTS}
        storage={storage}
      />
      {children}
    </>
  );
};

export default RealtimeDataProvider;
