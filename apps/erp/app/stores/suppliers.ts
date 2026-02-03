import { atom } from "nanostores";
import { useNanoStore } from "~/hooks";
import type { ListItem } from "~/types";

const $suppliersStore = atom<(ListItem & { website?: string | null })[]>([]);
export const useSuppliers = () => useNanoStore($suppliersStore, "suppliers");
