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
