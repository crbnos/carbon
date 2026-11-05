// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  assignDrawingFileNames,
  type DrawingFileClaim,
  drawingFileStem
} from "./onshape-drawing-names";
import { stripSpecialCharacters } from "./onshape-source-keys";

describe("drawingFileStem", () => {
  it.each([
    ["Bracket drawing", "Bracket drawing"],
    ["Bøyle Æ-plate", "Boyle AE-plate"],
    ["Écrou à oreilles", "Ecrou a oreilles"],
    ["Plate / top view", "Plate - top view"],
    ["Rev #3: final?", "Rev -3- final"],
    ["  Pin\tdrawing  ", "Pin drawing"],
    ["../Drawing.", "Drawing"],
    ["図面", "Drawing"],
    ["", "Drawing"]
  ])("names %j as %j", (name, stem) => {
    expect(drawingFileStem(name)).toBe(stem);
  });

  it("keeps a long name to 100 characters", () => {
    expect(drawingFileStem(`${"a".repeat(98)} - tail`)).toBe("a".repeat(98));
  });

  it("only keeps characters the stored key keeps", () => {
    const stem = drawingFileStem('Ø/é?*:%#"<>|~`^[]{}\\ drawing');
    expect(stripSpecialCharacters(stem)).toBe(stem);
    expect(stem).not.toContain("/");
  });
});

describe("assignDrawingFileNames", () => {
  const claim = (over: Partial<DrawingFileClaim>): DrawingFileClaim => ({
    drawingElementId: "drw-a",
    name: "Drawing 1",
    recorded: null,
    ...over
  });
  const assign = (
    over: Partial<Parameters<typeof assignDrawingFileNames>[0]>
  ) =>
    assignDrawingFileNames({
      partNumber: "PLT-020",
      files: [],
      reserved: [],
      claims: [],
      ...over
    });

  it("names a drawing's PDF after the drawing", () => {
    expect(assign({ claims: [claim({ name: "Plate" })] })).toEqual({
      "drw-a": "Plate.pdf"
    });
  });

  it("numbers same-named drawings in element id order", () => {
    expect(
      assign({
        claims: [
          claim({ drawingElementId: "drw-b" }),
          claim({ drawingElementId: "drw-a" })
        ]
      })
    ).toEqual({ "drw-a": "Drawing 1.pdf", "drw-b": "Drawing 1 (2).pdf" });
  });

  it("keeps a recorded number when the drawing that held the plain name is gone", () => {
    expect(
      assign({
        files: ["Drawing 1 (2).pdf"],
        claims: [
          claim({ drawingElementId: "drw-b", recorded: "Drawing 1 (2).pdf" })
        ]
      })
    ).toEqual({ "drw-b": "Drawing 1 (2).pdf" });
  });

  it("does not overwrite a file another drawing or a person put on the item", () => {
    expect(
      assign({
        files: ["Plate.pdf"],
        reserved: ["Plate (2).pdf"],
        claims: [claim({ name: "Plate" })]
      })
    ).toEqual({ "drw-a": "Plate (3).pdf" });
  });

  it("renames a renamed drawing and leaves its old name taken this push", () => {
    expect(
      assign({
        files: ["Drawing 1.pdf"],
        claims: [
          claim({ name: "Plate", recorded: "Drawing 1.pdf" }),
          claim({ drawingElementId: "drw-b", name: "Drawing 1" })
        ]
      })
    ).toEqual({ "drw-a": "Plate.pdf", "drw-b": "Drawing 1 (2).pdf" });
  });

  it("gives a drawing named like the item's released drawing a number", () => {
    expect(
      assign({
        claims: [
          claim({ name: "PLT-020-B" }),
          claim({ drawingElementId: "drw-b", name: "PLT-020-plate" })
        ]
      })
    ).toEqual({ "drw-a": "PLT-020-B (2).pdf", "drw-b": "PLT-020-plate.pdf" });
  });
});
