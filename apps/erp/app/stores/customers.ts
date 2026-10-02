// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { atom } from "nanostores";
import { useNanoStore } from "~/hooks";
import type { ListItem } from "~/types";

const $customersStore = atom<
  (Omit<ListItem, "readableId"> & {
    website?: string | null;
    readableId?: string | null;
  })[]
>([]);
export const useCustomers = () => useNanoStore($customersStore, "customers");
