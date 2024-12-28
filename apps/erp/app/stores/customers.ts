import { atom } from "nanostores";
import { useNanoStore } from "~/hooks";
import type { ListItem } from "~/types";

const $customersStore = atom<ListItem[]>([]);
export const useCustomers = () => useNanoStore($customersStore, "customers");
