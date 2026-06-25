import { useStore as useValue } from "@nanostores/react";
import { atom, computed } from "nanostores";
import { useNanoStore } from "~/hooks";

// Stock Transfer Wizard Store
export type StockTransferWizardLine = {
  itemId: string;
  itemReadableId: string;
  description: string;
  thumbnailPath: string;
  fromStorageUnitId: string;
  fromStorageUnitName: string;
  toStorageUnitId: string;
  toStorageUnitName: string;
  quantityAvailable: number;
  quantity?: number;
  requiresSerialTracking: boolean;
  requiresBatchTracking: boolean;
};

export type StockTransferWizardState = {
  selectedToItemStorageUnitIds: Set<string>; // Set of "itemId:storageUnitId" composite keys selected in the "to" table
  lines: StockTransferWizardLine[];
};

const $wizardStore = atom<StockTransferWizardState>({
  selectedToItemStorageUnitIds: new Set(),
  lines: []
});

const $wizardLinesCount = computed(
  $wizardStore,
  (wizard) => wizard.lines.filter((line) => (line.quantity ?? 0) > 0).length
);

export const useStockTransferWizard = () =>
  useNanoStore<StockTransferWizardState>($wizardStore, "wizard");
export const useStockTransferWizardLinesCount = () =>
  useValue($wizardLinesCount);

// Stock Transfer Wizard actions
export const toggleToItemStorageUnitSelection = (
  itemId: string,
  storageUnitId: string
) => {
  const currentWizard = $wizardStore.get();
  const compositeKey = `${itemId}:${storageUnitId}`;
  const newSelectedToItemStorageUnitIds = new Set(
    currentWizard.selectedToItemStorageUnitIds
  );

  if (newSelectedToItemStorageUnitIds.has(compositeKey)) {
    newSelectedToItemStorageUnitIds.delete(compositeKey);
    // Remove all lines that have this itemId and toStorageUnitId
    const updatedLines = currentWizard.lines.filter(
      (line) =>
        !(line.itemId === itemId && line.toStorageUnitId === storageUnitId)
    );
    $wizardStore.set({
      selectedToItemStorageUnitIds: newSelectedToItemStorageUnitIds,
      lines: updatedLines
    });
  } else {
    newSelectedToItemStorageUnitIds.add(compositeKey);
    $wizardStore.set({
      ...currentWizard,
      selectedToItemStorageUnitIds: newSelectedToItemStorageUnitIds
    });
  }
};

export const isToItemStorageUnitSelected = (
  itemId: string,
  storageUnitId: string
) => {
  const currentWizard = $wizardStore.get();
  const compositeKey = `${itemId}:${storageUnitId}`;
  return currentWizard.selectedToItemStorageUnitIds.has(compositeKey);
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
  fromStorageUnitId: string,
  toStorageUnitId: string
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

export const hasTransferLine = (
  itemId: string,
  fromStorageUnitId: string,
  toStorageUnitId: string
) => {
  const currentWizard = $wizardStore.get();
  return currentWizard.lines.some(
    (line) =>
      line.itemId === itemId &&
      line.fromStorageUnitId === fromStorageUnitId &&
      line.toStorageUnitId === toStorageUnitId
  );
};

export const hasTransferLinesToItemStorageUnit = (
  itemId: string,
  storageUnitId: string
) => {
  const currentWizard = $wizardStore.get();
  return currentWizard.lines.some(
    (line) =>
      line.itemId === itemId &&
      line.toStorageUnitId === storageUnitId &&
      (line.quantity ?? 0) > 0
  );
};

export const updateTransferLineQuantity = (
  itemId: string,
  fromStorageUnitId: string,
  toStorageUnitId: string,
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
    selectedToItemStorageUnitIds: new Set(),
    lines: []
  });
};

export const clearSelectedToItemStorageUnits = () => {
  const currentWizard = $wizardStore.get();
  $wizardStore.set({
    ...currentWizard,
    selectedToItemStorageUnitIds: new Set()
  });
};
