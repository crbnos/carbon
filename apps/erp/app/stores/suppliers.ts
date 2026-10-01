// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { atom } from "nanostores";
import { useNanoStore } from "~/hooks";
import type { ListItem } from "~/types";

const $suppliersStore = atom<
  (Omit<ListItem, "readableId"> & {
    website?: string | null;
    supplierStatus?: string | null;
    readableId?: string | null;
  })[]
>([]);
export const useSuppliers = () => useNanoStore($suppliersStore, "suppliers");
