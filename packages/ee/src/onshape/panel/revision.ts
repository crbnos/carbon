// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * Revision order, matching the sequences `getNextRevision` steps through:
 * numbers count up (9 → 10), letters go A → Z → AA → AB. A text compare gets
 * both wrong ("9" > "10", "Y" > "AA"), and Onshape's default scheme skips Z,
 * so a letter release lands on AA straight after Y.
 *
 * Numbers sort before letters (Carbon's unrevised "0" precedes a first
 * release's "A"); anything outside both schemes sorts after them, compared
 * naturally. Empty sorts first.
 */
export function compareRevisions(
  a: string | null | undefined,
  b: string | null | undefined
): number {
  const left = (a ?? "").trim();
  const right = (b ?? "").trim();
  const rank = revisionRank(left) - revisionRank(right);
  if (rank !== 0) return rank;

  if (isNumeric(left) && isNumeric(right)) {
    // By digits, not Number(): no precision limit on a long revision.
    const l = left.replace(/^0+(?=\d)/, "");
    const r = right.replace(/^0+(?=\d)/, "");
    if (l.length !== r.length) return l.length - r.length;
    if (l !== r) return l < r ? -1 : 1;
    // "01" and "1" are the same number; keep the order stable anyway.
    return left.localeCompare(right);
  }
  if (isLetters(left) && isLetters(right)) {
    if (left.length !== right.length) return left.length - right.length;
    return left.toUpperCase().localeCompare(right.toUpperCase());
  }
  return left.localeCompare(right, undefined, { numeric: true });
}

const isNumeric = (value: string) => /^\d+$/.test(value);
const isLetters = (value: string) => /^[A-Za-z]+$/.test(value);

function revisionRank(value: string): number {
  if (!value) return 0;
  if (isNumeric(value)) return 1;
  if (isLetters(value)) return 2;
  return 3;
}
