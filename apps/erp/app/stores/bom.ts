import { atom } from "nanostores";
import { useNanoStore } from "~/hooks";

const $bomStore = atom<{
  selectedMaterialId: string | null;
}>({
  selectedMaterialId: null,
});
export const useBom = () => useNanoStore($bomStore, "bom");
