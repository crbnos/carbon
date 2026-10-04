// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { fetchAllFromTable } from "@carbon/database";
import { type LiveList, useLiveList } from "@carbon/query";
import { useUser } from "~/hooks";
import type { ListItem } from "~/types";

export type Supplier = Omit<ListItem, "readableId"> & {
  website?: string | null;
  supplierStatus?: string | null;
  readableId?: string | null;
};

const COLUMNS = "id, name, website, supplierStatus, readableId";

export const suppliersList: LiveList<Supplier> = {
  name: "suppliers",
  table: "supplier",
  async fetchAll(carbon, companyId) {
    const rows = await fetchAllFromTable<Supplier>(
      carbon,
      "supplier",
      COLUMNS,
      (query) => query.eq("companyId", companyId).order("name")
    );
    if (rows.error) throw new Error("Failed to fetch suppliers");
    return rows.data ?? [];
  },
  async fetchByIds(carbon, companyId, ids) {
    const rows = await carbon
      .from("supplier")
      .select(COLUMNS)
      .eq("companyId", companyId)
      .in("id", ids);
    if (rows.error) throw new Error("Failed to fetch suppliers");
    return (rows.data ?? []) as Supplier[];
  },
  sort: (a, b) => a.name.localeCompare(b.name)
};

export const useSuppliers = () =>
  useLiveList(suppliersList, useUser().company.id);
