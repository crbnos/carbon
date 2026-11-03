// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { nanoid } from "nanoid";
import { create } from "zustand";

// New Stock Transfer drawer store. A line is keyed by its own id, not by
// (item, from, to): its To is edited after the line exists.
export type StockTransferWizardLine = {
  key: string;
  itemId: string;
  itemReadableId: string;
  description: string;
  thumbnailPath: string;
  unitOfMeasureCode: string | null;
  // Nullable: ledger rows can record stock against the location rather than a
  // bin ("No storage unit"), and the server accepts that for both ends.
  fromStorageUnitId: string | null;
  fromStorageUnitName: string | null;
  // A line raised from a bin that needs stock has its To fixed and no source
  // yet: `fromStorageUnitId` null means nothing until this is false.
  needsSource: boolean;
  // Raised by Fill: the source stays editable after it is chosen.
  fromFill?: boolean;
  toStorageUnitId: string | null;
  toStorageUnitName: string | null;
  // On hand at the source when the line was added.
  quantityAvailable: number;
  quantity: number;
  requiresSerialTracking: boolean;
  requiresBatchTracking: boolean;
};

export type StockTransferWizardState = {
  lines: StockTransferWizardLine[];
};

const useWizardStore = create<StockTransferWizardState>()(() => ({
  lines: []
}));

const $wizardStore = {
  get: useWizardStore.getState,
  set: (wizard: StockTransferWizardState) =>
    useWizardStore.setState(wizard, true)
};

export const useStockTransferWizard = () =>
  [useWizardStore(), $wizardStore.set] as const;

// Stock Transfer drawer actions

export const addTransferLine = (line: Omit<StockTransferWizardLine, "key">) => {
  const key = nanoid();
  const { lines } = $wizardStore.get();
  $wizardStore.set({ lines: [...lines, { ...line, key }] });
  return key;
};

export const addTransferLines = (
  newLines: Omit<StockTransferWizardLine, "key">[]
) => {
  const { lines } = $wizardStore.get();
  $wizardStore.set({
    lines: [...lines, ...newLines.map((line) => ({ ...line, key: nanoid() }))]
  });
};

export const updateTransferLine = (
  key: string,
  patch: Partial<Omit<StockTransferWizardLine, "key">>
) => {
  const { lines } = $wizardStore.get();
  $wizardStore.set({
    lines: lines.map((line) =>
      line.key === key ? { ...line, ...patch } : line
    )
  });
};

export const removeTransferLine = (key: string) => {
  const { lines } = $wizardStore.get();
  $wizardStore.set({ lines: lines.filter((line) => line.key !== key) });
};

// "Send all to": every line, except one whose source is that same bin.
export const setTransferLinesDestination = (
  storageUnitId: string,
  storageUnitName: string
) => {
  const { lines } = $wizardStore.get();
  $wizardStore.set({
    lines: lines.map((line) =>
      !line.needsSource && line.fromStorageUnitId === storageUnitId
        ? line
        : {
            ...line,
            toStorageUnitId: storageUnitId,
            toStorageUnitName: storageUnitName
          }
    )
  });
};

export const clearStockTransferWizard = () => {
  $wizardStore.set({ lines: [] });
};
