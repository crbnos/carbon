// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { fetchAllFromTable } from "@carbon/database";
import { type LiveList, useLiveList } from "@carbon/query";
import { useUser } from "~/hooks";
import type { ListItem } from "~/types";

export type Person = ListItem & { avatarUrl: string | null };

// Read from the `employees` view (user + employee + job). An employee's id is
// their user id, so a changed `employee` row — or a renamed `user`, which the
// change log records under `employee` — is re-read from the view by that id.
const COLUMNS = "id, name, email, avatarUrl, active";

export const peopleList: LiveList<Person> = {
  name: "people",
  table: "employee",
  async fetchAll(carbon, companyId) {
    const rows = await fetchAllFromTable<Person>(
      carbon,
      "employees",
      COLUMNS,
      (query) => query.eq("companyId", companyId).order("name")
    );
    if (rows.error) throw new Error("Failed to fetch people");
    return rows.data ?? [];
  },
  async fetchByIds(carbon, companyId, ids) {
    const rows = await carbon
      .from("employees")
      .select(COLUMNS)
      .eq("companyId", companyId)
      .in("id", ids);
    if (rows.error) throw new Error("Failed to fetch people");
    return (rows.data ?? []) as Person[];
  },
  sort: (a, b) => a.name.localeCompare(b.name)
};

export const usePeople = () => useLiveList(peopleList, useUser().company.id);
