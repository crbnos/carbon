import { describe, expect, it } from "vitest";
import type { RowMemoInputs } from "./rowMemo";
import { areRowPropsEqual } from "./rowMemo";

const ROW = { index: 3 };
const COLUMNS = [{ id: "name" }];

function props(overrides: Partial<RowMemoInputs> = {}): RowMemoInputs {
  return {
    row: ROW,
    visibleColumns: COLUMNS,
    selectedCell: null,
    rowIsSelected: false,
    isRowSelected: false,
    isEditing: false,
    isEditMode: false,
    isFrozenColumn: false,
    editedCells: undefined,
    className: undefined,
    pinnedStyleKey: "false:false|",
    ...overrides
  };
}

describe("areRowPropsEqual", () => {
  // The regression this whole change exists for: outside edit mode
  // `selectedCell` is null, and the old comparator comes out false here, so
  // every row re-rendered on every render of every table.
  it("skips the render when nothing changed in read mode", () => {
    expect(areRowPropsEqual(props(), props())).toBe(true);
  });

  it("skips the render for an unrelated row while a cell is selected", () => {
    const selectedCell = { row: 7, column: 2 };
    expect(
      areRowPropsEqual(
        props({ selectedCell, rowIsSelected: false }),
        props({ selectedCell, rowIsSelected: false })
      )
    ).toBe(true);
  });

  it("re-renders when the row data object changes", () => {
    expect(areRowPropsEqual(props(), props({ row: { index: 3 } }))).toBe(false);
  });

  it("re-renders when the visible columns are rebuilt", () => {
    expect(
      areRowPropsEqual(props(), props({ visibleColumns: [{ id: "name" }] }))
    ).toBe(false);
  });

  it("re-renders when this row gains or loses the selected cell", () => {
    const before = props({ rowIsSelected: false, selectedCell: null });
    const after = props({
      rowIsSelected: true,
      selectedCell: { row: 3, column: 1 }
    });
    expect(areRowPropsEqual(before, after)).toBe(false);
    expect(areRowPropsEqual(after, before)).toBe(false);
  });

  it("re-renders when the selected column moves within this row", () => {
    expect(
      areRowPropsEqual(
        props({ rowIsSelected: true, selectedCell: { row: 3, column: 1 } }),
        props({ rowIsSelected: true, selectedCell: { row: 3, column: 2 } })
      )
    ).toBe(false);
  });

  it("ignores a column move that lands on a different row", () => {
    expect(
      areRowPropsEqual(
        props({ rowIsSelected: false, selectedCell: { row: 7, column: 1 } }),
        props({ rowIsSelected: false, selectedCell: { row: 7, column: 2 } })
      )
    ).toBe(true);
  });

  it.each([
    ["isRowSelected", { isRowSelected: true }],
    ["isEditing", { isEditing: true }],
    ["isEditMode", { isEditMode: true }],
    ["isFrozenColumn", { isFrozenColumn: true }],
    ["editedCells", { editedCells: ["name"] }],
    ["className", { className: "cursor-pointer" }],
    ["pinnedStyleKey", { pinnedStyleKey: "true:false|Select@0" }]
  ])("re-renders when %s changes", (_label, override) => {
    expect(areRowPropsEqual(props(), props(override))).toBe(false);
  });
});
