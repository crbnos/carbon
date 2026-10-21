// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Jack-o'-lantern faces, built from parts: 6 eyes × 4 noses × 8 mouths, 192
// faces. A part is a mask of the cells the blade cuts out (`#`), placed
// relative to the pumpkin's centre. Every lantern also has a one-line
// version, `(^w^)`, for the procession on the hill.

import type { Random } from "./random";
import { floorOf } from "./random";

type Part = { mask: readonly string[]; mini: string };

const EYES: readonly (Part & { miniRight?: string })[] = [
  { mask: ["  #  ", " ### ", "#####"], mini: "^" },
  { mask: [" ### ", "#####", " ### "], mini: "o" },
  { mask: ["#    ", "###  ", "#####"], mini: ">", miniRight: "<" },
  { mask: ["  #  ", " ### ", "  #  "], mini: "*" },
  { mask: ["     ", "#####", " ### "], mini: "-" },
  { mask: [" ### ", "#   #", "     "], mini: "n" }
];

const NOSES: readonly Part[] = [
  { mask: [" # ", "###"], mini: "" },
  { mask: ["   ", " # "], mini: "" },
  { mask: ["###", " # "], mini: "" },
  { mask: [], mini: "" }
];

const MOUTHS: readonly Part[] = [
  {
    mask: ["#             #", " ############# ", "   #########   "],
    mini: "w"
  },
  {
    mask: ["###############", "## ## ### ## ##", " ############# "],
    mini: "m"
  },
  {
    mask: ["     #####     ", "    #######    ", "     #####     "],
    mini: "o"
  },
  { mask: ["##  ##   ##  ##", "  ##  ###  ##  "], mini: "v" },
  {
    mask: ["#             #", " ##         ## ", "   #########   "],
    mini: "u"
  },
  {
    mask: ["###############", "###############", " ############# "],
    mini: "D"
  },
  { mask: ["               ", "###############"], mini: "_" },
  { mask: ["###############", " ### ##### ### ", "  #    #    #  "], mini: "W" }
];

export const FACE_COUNT = EYES.length * NOSES.length * MOUTHS.length;

export type Face = { eyes: number; nose: number; mouth: number };

export function drawFace(random: Random): Face {
  return {
    eyes: floorOf(random() * EYES.length),
    nose: floorOf(random() * NOSES.length),
    mouth: floorOf(random() * MOUTHS.length)
  };
}

export type Cell = { x: number; y: number };

/** The smallest pumpkin, in rows, that holds every face (faces.test.ts). */
export const HERO_MIN_RADIUS = 5.6;

function maskCells(mask: readonly string[], left: number, top: number) {
  const cells: Cell[] = [];
  mask.forEach((line, row) => {
    for (let col = 0; col < line.length; col++) {
      if (line[col] === "#") cells.push({ x: left + col, y: top + row });
    }
  });
  return cells;
}

function mirrored(mask: readonly string[]) {
  return mask.map((line) => line.split("").reverse().join(""));
}

function width(mask: readonly string[]) {
  return mask.reduce((widest, line) => Math.max(widest, line.length), 0);
}

/**
 * The cells a face cuts out of a hero-sized pumpkin, relative to its centre,
 * in the order the blade cuts them: left eye, right eye, nose, mouth.
 */
export function carvedCells(face: Face): Cell[] {
  const eyes = EYES[face.eyes] ?? EYES[0];
  const nose = NOSES[face.nose] ?? NOSES[0];
  const mouth = MOUTHS[face.mouth] ?? MOUTHS[0];
  if (!eyes || !nose || !mouth) return [];
  const eyeWidth = width(eyes.mask);
  const half = floorOf(eyeWidth / 2);
  const right = eyes.miniRight ? mirrored(eyes.mask) : eyes.mask;
  return [
    ...maskCells(eyes.mask, -5 - half, -4),
    ...maskCells(right, 5 - half, -4),
    ...maskCells(nose.mask, -floorOf(width(nose.mask) / 2), -1),
    ...maskCells(mouth.mask, -floorOf(width(mouth.mask) / 2), 1)
  ];
}

/** The face on one line, as a lantern in the procession shows it. */
export function miniFace(face: Face): string {
  const eyes = EYES[face.eyes] ?? EYES[0];
  const mouth = MOUTHS[face.mouth] ?? MOUTHS[0];
  const left = eyes?.mini ?? "o";
  return `(${left}${mouth?.mini ?? "w"}${eyes?.miniRight ?? left})`;
}

/** A key for a carved cell, so a renderer can look cells up in a Set. */
export function cellKey(x: number, y: number) {
  return (x + 64) * 256 + (y + 64);
}
