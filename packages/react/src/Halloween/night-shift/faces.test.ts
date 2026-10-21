// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Every one of the 192 faces must fit inside the smallest pumpkin the Line
// draws, or the blade would cut air; and every face has a one-line version.

import { describe, expect, it } from "vitest";
import { carvedCells, FACE_COUNT, HERO_MIN_RADIUS, miniFace } from "./faces";

const ASPECT = 1.9;

function allFaces() {
  const faces = [];
  for (let eyes = 0; eyes < 6; eyes++) {
    for (let nose = 0; nose < 4; nose++) {
      for (let mouth = 0; mouth < 8; mouth++) faces.push({ eyes, nose, mouth });
    }
  }
  return faces;
}

describe("faces", () => {
  it("has 192 of them", () => {
    expect(FACE_COUNT).toBe(192);
    expect(allFaces()).toHaveLength(FACE_COUNT);
  });

  it("fits every face inside the smallest hero pumpkin", () => {
    const rx = HERO_MIN_RADIUS * ASPECT * 1.18;
    const ry = HERO_MIN_RADIUS;
    for (const face of allFaces()) {
      const cells = carvedCells(face);
      expect(cells.length).toBeGreaterThan(0);
      for (const cell of cells) {
        // The pumpkin's centre can sit anywhere inside its cell.
        for (const offset of [0, 0.99]) {
          const nx = (cell.x + 0.5 - offset) / rx;
          const ny = (cell.y + 0.5 - offset) / ry;
          expect(nx * nx + ny * ny).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("cuts the left eye first and the mouth last", () => {
    const cells = carvedCells({ eyes: 0, nose: 0, mouth: 0 });
    expect(cells[0]?.x).toBeLessThan(0);
    expect(cells.at(-1)?.y).toBeGreaterThan(0);
  });

  it("puts every face on one line, five characters wide", () => {
    for (const face of allFaces()) {
      const mini = miniFace(face);
      expect(mini).toHaveLength(5);
      expect(mini.startsWith("(")).toBe(true);
      expect(mini.endsWith(")")).toBe(true);
    }
    expect(miniFace({ eyes: 2, nose: 0, mouth: 0 })).toBe("(>w<)");
  });
});
