import { atom } from "nanostores";
import { useNanoStore } from "~/hooks";
import type { ListItem } from "~/types";

const $suppliersStore = atom<ListItem[]>([]);
export const useSuppliers = () => useNanoStore($suppliersStore, "suppliers");
