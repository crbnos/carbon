import { atom } from "nanostores";
import { useNanoStore } from "~/hooks";
import type { ListItem } from "~/types";

const $peopleStore = atom<(ListItem & { avatarUrl: string | null })[]>([]);
export const usePeople = () => useNanoStore($peopleStore, "people");
