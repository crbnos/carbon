import { useStore as useValue } from "@nanostores/react";
import { atom, computed } from "nanostores";
import { useNanoStore } from "~/hooks";

// Stock Transfer Wizard Store
export type StockTransferWizardLine = {
  itemId: string;
  itemReadableId: string;
  description: string;
  thumbnailPath: string;
  // Nullable: ledger rows can record stock against the location rather than a
  // bin, and the server validator accepts `nullish()` for both.
  fromStorageUnitId: string | null;
  fromStorageUnitName: string | null;
  toStorageUnitId: string | null;
  toStorageUnitName: string | null;
  quantityAvailable: number;
  quantity?: number;
  requiresSerialTracking: boolean;
  requiresBatchTracking: boolean;
};

export type StockTransferDestination = {
  itemId: string;
  storageUnitId: string | null;
};

export type StockTransferWizardState = {
  // The destination row (item + bin) stock is being pulled into. Focus only —
  // changing it never mutates lines, so lines accumulate across destinations.
  activeDestination: StockTransferDestination | null;
  lines: StockTransferWizardLine[];
};

const $wizardStore = atom<StockTransferWizardState>({
  activeDestination: null,
  lines: []
});

const $wizardLinesCount = computed(
  $wizardStore,
  (wizard) => wizard.lines.filter((line) => (line.quantity ?? 0) > 0).length
);

const $wizardTotalQuantity = computed($wizardStore, (wizard) =>
  wizard.lines.reduce((sum, line) => sum + (line.quantity ?? 0), 0)
);

export const useStockTransferWizard = () =>
  useNanoStore<StockTransferWizardState>($wizardStore, "wizard");
export const useStockTransferWizardLinesCount = () =>
  useValue($wizardLinesCount);
export const useStockTransferWizardTotalQuantity = () =>
  useValue($wizardTotalQuantity);

// Stock Transfer Wizard actions

// Focus a destination (item + bin) to pull stock into. Clicking the active one
// again clears focus. Lines are never touched — removal is always explicit.
export const setActiveDestination = (
  destination: StockTransferDestination | null
) => {
  const currentWizard = $wizardStore.get();
  $wizardStore.set({ ...currentWizard, activeDestination: destination });
};

export const isActiveDestination = (
  itemId: string,
  storageUnitId: string | null
) => {
  const { activeDestination } = $wizardStore.get();
  return (
    activeDestination?.itemId === itemId &&
    activeDestination?.storageUnitId === storageUnitId
  );
};

export const addTransferLine = (line: StockTransferWizardLine) => {
  const currentWizard = $wizardStore.get();

  // Check if a line with same itemId, fromStorageUnitId and toStorageUnitId already exists
  const existingLineIndex = currentWizard.lines.findIndex(
    (l) =>
      l.itemId === line.itemId &&
      l.fromStorageUnitId === line.fromStorageUnitId &&
      l.toStorageUnitId === line.toStorageUnitId
  );

  if (existingLineIndex >= 0) {
    // Update existing line
    const updatedLines = [...currentWizard.lines];
    updatedLines[existingLineIndex] = {
      ...updatedLines[existingLineIndex],
      ...line
    };
    $wizardStore.set({ ...currentWizard, lines: updatedLines });
  } else {
    // Add new line
    $wizardStore.set({
      ...currentWizard,
      lines: [...currentWizard.lines, line]
    });
  }
};

export const removeTransferLine = (
  itemId: string,
  fromStorageUnitId: string | null,
  toStorageUnitId: string | null
) => {
  const currentWizard = $wizardStore.get();
  const updatedLines = currentWizard.lines.filter(
    (line) =>
      !(
        line.itemId === itemId &&
        line.fromStorageUnitId === fromStorageUnitId &&
        line.toStorageUnitId === toStorageUnitId
      )
  );
  $wizardStore.set({ ...currentWizard, lines: updatedLines });
};

export const updateTransferLineQuantity = (
  itemId: string,
  fromStorageUnitId: string | null,
  toStorageUnitId: string | null,
  quantity: number
) => {
  const currentWizard = $wizardStore.get();
  const lineIndex = currentWizard.lines.findIndex(
    (line) =>
      line.itemId === itemId &&
      line.fromStorageUnitId === fromStorageUnitId &&
      line.toStorageUnitId === toStorageUnitId
  );

  if (lineIndex >= 0) {
    const updatedLines = [...currentWizard.lines];
    updatedLines[lineIndex] = {
      ...updatedLines[lineIndex],
      quantity
    };
    $wizardStore.set({ ...currentWizard, lines: updatedLines });
  }
};

export const clearStockTransferWizard = () => {
  $wizardStore.set({
    activeDestination: null,
    lines: []
  });
};

export const clearTransferLines = () => {
  const currentWizard = $wizardStore.get();
  $wizardStore.set({ ...currentWizard, lines: [] });
};
