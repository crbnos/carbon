// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { fetchAllFromTable } from "@carbon/database";
import { type LiveList, useLiveList } from "@carbon/query";
import { useUser } from "~/hooks";
import type { ListItem } from "~/types";

export type Person = ListItem & { avatarUrl: string | null; active?: boolean };

// Read from the `employees` view (user + employee + job), so a changed
// `employee` row cannot be re-read by its id alone: any change refetches the
// list. A renamed user sends nothing here; the checksum catches it on the next
// load or reconnect.
export const peopleList: LiveList<Person> = {
  name: "people",
  table: "employee",
  async fetchAll(carbon, companyId) {
    const rows = await fetchAllFromTable<Person>(
      carbon,
      "employees",
      "id, name, email, avatarUrl, active",
      (query) => query.eq("companyId", companyId).order("name")
    );
    if (rows.error) throw new Error("Failed to fetch people");
    return rows.data ?? [];
  },
  sort: (a, b) => a.name.localeCompare(b.name)
};

export const usePeople = () => useLiveList(peopleList, useUser().company.id);
