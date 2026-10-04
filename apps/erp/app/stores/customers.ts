// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { fetchAllFromTable } from "@carbon/database";
import { type LiveList, useLiveList } from "@carbon/query";
import { useUser } from "~/hooks";
import type { ListItem } from "~/types";

export type Customer = Omit<ListItem, "readableId"> & {
  website?: string | null;
  readableId?: string | null;
};

const COLUMNS = "id, name, website, readableId";

export const customersList: LiveList<Customer> = {
  name: "customers",
  table: "customer",
  async fetchAll(carbon, companyId) {
    const rows = await fetchAllFromTable<Customer>(
      carbon,
      "customer",
      COLUMNS,
      (query) => query.eq("companyId", companyId).order("name")
    );
    if (rows.error) throw new Error("Failed to fetch customers");
    return rows.data ?? [];
  },
  async fetchByIds(carbon, companyId, ids) {
    const rows = await carbon
      .from("customer")
      .select(COLUMNS)
      .eq("companyId", companyId)
      .in("id", ids);
    if (rows.error) throw new Error("Failed to fetch customers");
    return (rows.data ?? []) as Customer[];
  },
  sort: (a, b) => a.name.localeCompare(b.name)
};

export const useCustomers = () =>
  useLiveList(customersList, useUser().company.id);
