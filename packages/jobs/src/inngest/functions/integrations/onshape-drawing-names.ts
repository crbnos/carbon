// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The file name a drawing PDF gets on an item: the drawing's name in Onshape.
// The item's Files card shows the stored file name and nothing else, so the
// file name is the only label a person sees.

const MAX_STEM_LENGTH = 100;

// Letters NFKD does not split into a base letter and a mark.
const PLAIN_LETTERS: Record<string, string> = {
  ø: "o",
  Ø: "O",
  æ: "ae",
  Æ: "AE",
  œ: "oe",
  Œ: "OE",
  ß: "ss",
  ł: "l",
  Ł: "L",
  đ: "d",
  Đ: "D",
  ð: "d",
  Ð: "D",
  þ: "th",
  Þ: "Th",
  ı: "i"
};

/**
 * A drawing's name as the stem of its PDF's file name. A letter with an
 * accent becomes the plain letter (é → e, ø → o), and every run of characters
 * a stored file name cannot hold, or that would name a folder (`/`), becomes
 * one `-`. Every character left is one `stripSpecialCharacters` keeps, so the
 * stored key holds this name as it is.
 */
export function drawingFileStem(name: string): string {
  const plain = Array.from(name.normalize("NFKD"), (c) => PLAIN_LETTERS[c] ?? c)
    .join("")
    .replace(/\p{M}/gu, "");
  const stem = plain
    .replace(/\s+/g, " ")
    .replace(/[^A-Za-z0-9 _.,;=+&$@!'()-]+/g, "-")
    .slice(0, MAX_STEM_LENGTH)
    .replace(/^[\s.-]+|[\s.-]+$/g, "");
  return stem || "Drawing";
}

/** The file name of copy `copy` of a stem: `Plate.pdf`, `Plate (2).pdf`, … */
export function drawingFileName(stem: string, copy: number): string {
  return copy <= 1 ? `${stem}.pdf` : `${stem} (${copy}).pdf`;
}

/** Which copy of `stem` a file name is, or null when it is not one. */
function copyOf(stem: string, fileName: string): number | null {
  if (fileName === `${stem}.pdf`) return 1;
  const prefix = `${stem} (`;
  if (!fileName.startsWith(prefix) || !fileName.endsWith(").pdf")) return null;
  const copy = fileName.slice(prefix.length, -").pdf".length);
  return /^[1-9]\d*$/.test(copy) && Number(copy) >= 2 ? Number(copy) : null;
}

/**
 * Whether the panel's Releases tab would read a stem as an item's released
 * drawing: `<part number>-<revision>`, the name a release gives one
 * (`releaseDrawingFileName`). A revision is taken to be 1 to 3 capital
 * letters or digits. Such a stem starts at copy 2.
 */
export function readsAsReleaseDrawing(
  stem: string,
  partNumber: string
): boolean {
  return (
    stem.startsWith(`${partNumber}-`) &&
    /^[A-Z0-9]{1,3}$/.test(stem.slice(partNumber.length + 1))
  );
}

export type DrawingFileClaim = {
  drawingElementId: string;
  /** The drawing's name in Onshape. */
  name: string;
  /** The file name the drawing's record holds on the item, if any. */
  recorded: string | null;
};

/**
 * The file name each drawing gets on one item, by drawing element id: its own
 * name, numbered from " (2)" when another file on the item has that name. A
 * drawing whose recorded file name is still a copy of its name keeps it, so a
 * number stays with its drawing from push to push.
 *
 * Taken are every file on the item, every name a record holds (`reserved`
 * for drawings not in `claims`), and each name given in this call. Recorded
 * names stay taken while their drawing moves away from them, so no other
 * drawing takes a file that is still being renamed.
 */
export function assignDrawingFileNames(input: {
  partNumber: string;
  files: string[];
  reserved: string[];
  claims: DrawingFileClaim[];
}): Record<string, string> {
  const taken = new Set([
    ...input.files,
    ...input.reserved,
    ...input.claims.flatMap((claim) => (claim.recorded ? [claim.recorded] : []))
  ]);
  const firstCopy = (stem: string) =>
    readsAsReleaseDrawing(stem, input.partNumber) ? 2 : 1;

  const names: Record<string, string> = {};
  const kept = new Set<string>();
  const rest: DrawingFileClaim[] = [];
  for (const claim of input.claims) {
    const stem = drawingFileStem(claim.name);
    const copy = claim.recorded ? copyOf(stem, claim.recorded) : null;
    if (
      claim.recorded &&
      copy !== null &&
      copy >= firstCopy(stem) &&
      !kept.has(claim.recorded)
    ) {
      names[claim.drawingElementId] = claim.recorded;
      kept.add(claim.recorded);
    } else {
      rest.push(claim);
    }
  }

  // In element id order, so the same drawings get the same numbers each push.
  rest.sort((a, b) =>
    a.drawingElementId < b.drawingElementId
      ? -1
      : a.drawingElementId > b.drawingElementId
        ? 1
        : 0
  );
  for (const claim of rest) {
    const stem = drawingFileStem(claim.name);
    let copy = firstCopy(stem);
    while (taken.has(drawingFileName(stem, copy))) copy++;
    const fileName = drawingFileName(stem, copy);
    names[claim.drawingElementId] = fileName;
    taken.add(fileName);
  }
  return names;
}
