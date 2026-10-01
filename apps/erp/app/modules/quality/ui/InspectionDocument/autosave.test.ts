// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  hasUnsavedRows,
  mergeSaveResponse,
  newBalloonId,
  newFeatureId
} from "./autosave";

type Row = {
  featureId: string;
  balloonId: string | null;
  label: string;
  featureDirty?: boolean;
  geometryDirty?: boolean;
};

type Anchor = { id: string; isNew: boolean; isDirty: boolean };

const row = (featureId: string, label: string, extra: Partial<Row> = {}) =>
  ({ featureId, balloonId: null, label, ...extra }) satisfies Row as Row;

const merge = (args: {
  sentRows: Row[];
  currentRows: Row[];
  savedRows: Row[];
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
    savedAnchors: args.savedAnchors ?? []
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

  it("keeps an edit made during the save, still dirty", () => {
    const sent = row("ift_a", "1");
    const edited = { ...sent, label: "1A", featureDirty: true };
    const { rows } = merge({
      sentRows: [sent],
      currentRows: [edited],
      savedRows: [row("ift_a", "1")]
    });
    expect(rows).toEqual([edited]);
  });

  it("keeps a row added during the save", () => {
    const a = row("ift_a", "1");
    const added = row("ift_b", "2");
    const { rows } = merge({
      sentRows: [a],
      currentRows: [a, added],
      savedRows: [a]
    });
    expect(rows).toEqual([a, added]);
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

  it("turns an anchor the save created, then moved, into an update", () => {
    const placed = { id: "bbn_a", isNew: true, isDirty: false };
    const moved = { ...placed };
    const { anchors } = merge({
      sentRows: [],
      currentRows: [],
      savedRows: [],
      sentAnchors: [placed],
      currentAnchors: [moved],
      savedAnchors: [{ id: "bbn_a", isNew: false, isDirty: false }]
    });
    expect(anchors).toEqual([{ id: "bbn_a", isNew: false, isDirty: true }]);
  });

  it("takes the server's copy of an anchor untouched since the save", () => {
    const placed = { id: "bbn_a", isNew: true, isDirty: false };
    const saved = { id: "bbn_a", isNew: false, isDirty: false };
    const { anchors } = merge({
      sentRows: [],
      currentRows: [],
      savedRows: [],
      sentAnchors: [placed],
      currentAnchors: [placed],
      savedAnchors: [saved]
    });
    expect(anchors).toEqual([saved]);
  });
});

describe("hasUnsavedRows", () => {
  const none = () => false;

  it("is false once every row and anchor is saved and clean", () => {
    expect(
      hasUnsavedRows(
        [row("ift_a", "1", { balloonId: "bbn_a" })],
        [{ id: "bbn_a", isNew: false, isDirty: false }],
        none
      )
    ).toBe(false);
  });

  it("is true for an unsaved row or balloon", () => {
    const unsaved = (id: string) => id === "ift_new" || id === "bbn_new";
    expect(hasUnsavedRows([row("ift_new", "1")], [], unsaved)).toBe(true);
    expect(
      hasUnsavedRows([row("ift_a", "1", { balloonId: "bbn_new" })], [], unsaved)
    ).toBe(true);
  });

  it("is true for an edited row or a moved anchor", () => {
    expect(
      hasUnsavedRows([row("ift_a", "1", { featureDirty: true })], [], none)
    ).toBe(true);
    expect(
      hasUnsavedRows([], [{ id: "bbn_a", isNew: false, isDirty: true }], none)
    ).toBe(true);
  });
});

describe("minted ids", () => {
  it("carry the table's prefix and pass the save validator's shape", () => {
    expect(newFeatureId()).toMatch(/^ift_[A-Za-z0-9_-]{8,60}$/);
    expect(newBalloonId()).toMatch(/^bbn_[A-Za-z0-9_-]{8,60}$/);
    expect(newFeatureId()).not.toBe(newFeatureId());
  });
});
