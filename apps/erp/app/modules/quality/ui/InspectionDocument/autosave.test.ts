import { describe, expect, it } from "vitest";
import { hasUnsavedRows, mergeSaveResponse } from "./autosave";

type Row = {
  featureId: string;
  balloonId: string | null;
  balloonAnchorId: string;
  label: string;
  featureDirty?: boolean;
  geometryDirty?: boolean;
};

type Anchor = { id: string; isNew: boolean; isDirty: boolean };

const row = (featureId: string, label: string, extra: Partial<Row> = {}) =>
  ({
    featureId,
    balloonId: null,
    balloonAnchorId: "",
    label,
    ...extra
  }) satisfies Row as Row;

const merge = (args: {
  sentRows: Row[];
  currentRows: Row[];
  savedRows: Row[];
  persisted?: Record<string, string>;
  sentAnchors?: Anchor[];
  currentAnchors?: Anchor[];
  savedAnchors?: Anchor[];
}) =>
  mergeSaveResponse<Row, Anchor>({
    sentRows: args.sentRows,
    currentRows: args.currentRows,
    savedRows: args.savedRows,
    sentAnchors: args.sentAnchors ?? [],
    currentAnchors: args.currentAnchors ?? [],
    savedAnchors: args.savedAnchors ?? [],
    persistedIds: new Map(Object.entries(args.persisted ?? {}))
  });

describe("mergeSaveResponse", () => {
  it("takes the server's copy of rows untouched since the save", () => {
    const a = row("ift_a", "1", { featureDirty: true });
    const saved = row("ift_a", "1");
    const { rows } = merge({
      sentRows: [a],
      currentRows: [a],
      savedRows: [saved]
    });
    expect(rows).toEqual([saved]);
  });

  it("gives a created row its persisted id", () => {
    const temp = row("temp-ftr-1", "1");
    const saved = row("ift_new", "1");
    const { rows } = merge({
      sentRows: [temp],
      currentRows: [temp],
      savedRows: [saved],
      persisted: { "temp-ftr-1": "ift_new" }
    });
    expect(rows).toEqual([saved]);
  });

  it("keeps an edit made during the save, re-pointed and still dirty", () => {
    const temp = row("temp-ftr-1", "1");
    const edited = { ...temp, label: "1A" };
    const { rows } = merge({
      sentRows: [temp],
      currentRows: [edited],
      savedRows: [row("ift_new", "1")],
      persisted: { "temp-ftr-1": "ift_new" }
    });
    expect(rows).toEqual([
      {
        ...edited,
        featureId: "ift_new",
        featureDirty: true,
        geometryDirty: false
      }
    ]);
  });

  it("re-points a balloon placed before the save and moved during it", () => {
    const temp = row("temp-ftr-1", "1", {
      balloonId: "temp-bln-1",
      balloonAnchorId: "temp-bln-1",
      geometryDirty: true
    });
    const moved = { ...temp };
    const { rows } = merge({
      sentRows: [temp],
      currentRows: [moved],
      savedRows: [],
      persisted: { "temp-ftr-1": "ift_new", "temp-bln-1": "bln_new" }
    });
    expect(rows[0]).toMatchObject({
      featureId: "ift_new",
      balloonId: "bln_new",
      balloonAnchorId: "bln_new",
      featureDirty: true,
      geometryDirty: true
    });
  });

  it("deletes a row the save created but the user deleted meanwhile", () => {
    const temp = row("temp-ftr-1", "1");
    const { rows, featureDeleteIds } = merge({
      sentRows: [temp],
      currentRows: [],
      savedRows: [row("ift_new", "1")],
      persisted: { "temp-ftr-1": "ift_new" }
    });
    expect(rows).toEqual([]);
    expect(featureDeleteIds).toEqual(["ift_new"]);
  });

  it("deletes a balloon the save created but the user removed meanwhile", () => {
    const placed = row("ift_a", "1", {
      balloonId: "temp-bln-1",
      balloonAnchorId: "temp-bln-1"
    });
    const unballooned = { ...placed, balloonId: null, balloonAnchorId: "" };
    const { balloonDeleteIds, featureDeleteIds } = merge({
      sentRows: [placed],
      currentRows: [unballooned],
      savedRows: [],
      persisted: { "temp-bln-1": "bln_new" }
    });
    expect(balloonDeleteIds).toEqual(["bln_new"]);
    expect(featureDeleteIds).toEqual([]);
  });

  it("keeps the editor's order rather than the server's", () => {
    const one = row("ift_1", "1");
    const twelve = row("ift_2", "12");
    const eleven = row("ift_3", "11");
    // The server sorts by label; the editor shows the rows as the user left them.
    const { rows } = merge({
      sentRows: [one, twelve, eleven],
      currentRows: [one, twelve, eleven],
      savedRows: [one, eleven, twelve]
    });
    expect(rows.map((r) => r.featureId)).toEqual(["ift_1", "ift_2", "ift_3"]);
  });

  it("re-points a new anchor edited during the save", () => {
    const anchor = { id: "temp-bln-1", isNew: true, isDirty: false };
    const resized = { ...anchor };
    const { anchors } = merge({
      sentRows: [],
      currentRows: [],
      savedRows: [],
      sentAnchors: [anchor],
      currentAnchors: [resized],
      savedAnchors: [{ id: "bln_new", isNew: false, isDirty: false }],
      persisted: { "temp-bln-1": "bln_new" }
    });
    expect(anchors).toEqual([{ id: "bln_new", isNew: false, isDirty: true }]);
  });
});

describe("hasUnsavedRows", () => {
  it("is false once every row and anchor is persisted and clean", () => {
    expect(
      hasUnsavedRows(
        [row("ift_a", "1")],
        [{ id: "bln_a", isNew: false, isDirty: false }]
      )
    ).toBe(false);
  });

  it("is true for a new row, an edited row or a moved anchor", () => {
    expect(hasUnsavedRows([row("temp-ftr-1", "1")], [])).toBe(true);
    expect(
      hasUnsavedRows([row("ift_a", "1", { featureDirty: true })], [])
    ).toBe(true);
    expect(
      hasUnsavedRows([], [{ id: "bln_a", isNew: false, isDirty: true }])
    ).toBe(true);
  });
});
