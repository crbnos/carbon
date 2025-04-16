import { atom } from "nanostores";
import { useNanoStore } from "~/hooks";

const $bomStore = atom<string | null>(null);
export const useBom = () => useNanoStore($bomStore, "bom");
