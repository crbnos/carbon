/**
 * Attribute sampling standards (ANSI/ASQ Z1.4 and ISO 2859-1).
 *
 * Data tables taken from the standards; ISO 2859-1 cells match Z1.4 for the
 * plans we expose. Divergences should be encoded as overrides in
 * SAMPLING_STANDARDS[standard].* below — do NOT special-case in the resolver.
 *
 * The resolver is a pure function: given a sampling plan, a lot size, and a
 * standard, it returns { sampleSize, acceptance, rejection, codeLetter, standard }.
 * Used by the Quality-tab preview AND by the post-receipt function to snapshot
 * a plan onto each lot.
 */

export const samplingStandards = ["ANSI_Z1_4", "ISO_2859_1"] as const;
export type SamplingStandard = (typeof samplingStandards)[number];

export const samplingPlanTypes = ["All", "First", "Percentage", "AQL"] as const;
export type SamplingPlanType = (typeof samplingPlanTypes)[number];

export const inspectionLevels = [
  "I",
  "II",
  "III",
  "S1",
  "S2",
  "S3",
  "S4"
] as const;
export type InspectionLevel = (typeof inspectionLevels)[number];

export const inspectionSeverities = ["Normal", "Tightened", "Reduced"] as const;
export type InspectionSeverity = (typeof inspectionSeverities)[number];

export const standardAqlValues = [
  0.065, 0.1, 0.15, 0.25, 0.4, 0.65, 1.0, 1.5, 2.5, 4.0, 6.5, 10.0
] as const;
export type StandardAql = (typeof standardAqlValues)[number];

// ---------------------------------------------------------------------------
// Table I — lot size × inspection level → code letter
// Identical between Z1.4 and ISO 2859-1.
// ---------------------------------------------------------------------------

type LotRange = { min: number; max: number };
type CodeLetterRow = {
  range: LotRange;
  levels: Record<InspectionLevel, string>;
};

const CODE_LETTER_TABLE: CodeLetterRow[] = [
  // lot      S1   S2   S3   S4    I    II   III
  { range: r(2, 8), levels: l("A", "A", "A", "A", "A", "A", "B") },
  { range: r(9, 15), levels: l("A", "A", "A", "A", "A", "B", "C") },
  { range: r(16, 25), levels: l("A", "A", "B", "B", "B", "C", "D") },
  { range: r(26, 50), levels: l("A", "B", "B", "C", "C", "D", "E") },
  { range: r(51, 90), levels: l("B", "B", "C", "C", "C", "E", "F") },
  { range: r(91, 150), levels: l("B", "B", "C", "D", "D", "F", "G") },
  { range: r(151, 280), levels: l("B", "C", "D", "E", "E", "G", "H") },
  { range: r(281, 500), levels: l("B", "C", "D", "E", "F", "H", "J") },
  { range: r(501, 1200), levels: l("C", "C", "E", "F", "G", "J", "K") },
  { range: r(1201, 3200), levels: l("C", "D", "E", "G", "H", "K", "L") },
  { range: r(3201, 10000), levels: l("C", "D", "F", "G", "J", "L", "M") },
  { range: r(10001, 35000), levels: l("C", "D", "F", "H", "K", "M", "N") },
  { range: r(35001, 150000), levels: l("D", "E", "G", "J", "L", "N", "P") },
  { range: r(150001, 500000), levels: l("D", "E", "G", "J", "M", "P", "Q") },
  {
    range: r(500001, Number.MAX_SAFE_INTEGER),
    levels: l("D", "E", "H", "K", "N", "Q", "R")
  }
];

function r(min: number, max: number): LotRange {
  return { min, max };
}

function l(
  s1: string,
  s2: string,
  s3: string,
  s4: string,
  i: string,
  ii: string,
  iii: string
): Record<InspectionLevel, string> {
  return { S1: s1, S2: s2, S3: s3, S4: s4, I: i, II: ii, III: iii };
}

// ---------------------------------------------------------------------------
// Table II — code letter × AQL → { n, Ac, Re }
// One block per severity. Special tokens:
//   "↓"  use next lower letter's plan (arrow-down in the book)
//   "↑"  use next higher letter's plan (arrow-up in the book)
// For readability in TS we precompute the dereferenced plans below.
// ---------------------------------------------------------------------------

export type SinglePlanCell = {
  n: number;
  Ac: number;
  Re: number;
};

type SeverityBlock = Record<
  string /* code letter */,
  Record<number /* AQL */, SinglePlanCell>
>;

/**
 * Z1.4 Table II-A — Single sampling, Normal inspection.
 * Rows A–R × AQL 0.065 … 10.0.
 * Source: ANSI/ASQ Z1.4-2003 Table II-A (arrow tokens resolved).
 */
const Z14_SINGLE_NORMAL: SeverityBlock = {
  A: {
    0.065: p(2, 0, 1),
    0.1: p(2, 0, 1),
    0.15: p(2, 0, 1),
    0.25: p(2, 0, 1),
    0.4: p(2, 0, 1),
    0.65: p(2, 0, 1),
    1.0: p(2, 0, 1),
    1.5: p(2, 0, 1),
    2.5: p(2, 0, 1),
    4.0: p(2, 0, 1),
    6.5: p(2, 0, 1),
    10.0: p(2, 0, 1)
  },
  B: {
    0.065: p(3, 0, 1),
    0.1: p(3, 0, 1),
    0.15: p(3, 0, 1),
    0.25: p(3, 0, 1),
    0.4: p(3, 0, 1),
    0.65: p(3, 0, 1),
    1.0: p(3, 0, 1),
    1.5: p(3, 0, 1),
    2.5: p(3, 0, 1),
    4.0: p(3, 0, 1),
    6.5: p(3, 0, 1),
    10.0: p(3, 1, 2)
  },
  C: {
    0.065: p(5, 0, 1),
    0.1: p(5, 0, 1),
    0.15: p(5, 0, 1),
    0.25: p(5, 0, 1),
    0.4: p(5, 0, 1),
    0.65: p(5, 0, 1),
    1.0: p(5, 0, 1),
    1.5: p(5, 0, 1),
    2.5: p(5, 0, 1),
    4.0: p(5, 0, 1),
    6.5: p(5, 1, 2),
    10.0: p(5, 2, 3)
  },
  D: {
    0.065: p(8, 0, 1),
    0.1: p(8, 0, 1),
    0.15: p(8, 0, 1),
    0.25: p(8, 0, 1),
    0.4: p(8, 0, 1),
    0.65: p(8, 0, 1),
    1.0: p(8, 0, 1),
    1.5: p(8, 0, 1),
    2.5: p(8, 0, 1),
    4.0: p(8, 1, 2),
    6.5: p(8, 2, 3),
    10.0: p(8, 3, 4)
  },
  E: {
    0.065: p(13, 0, 1),
    0.1: p(13, 0, 1),
    0.15: p(13, 0, 1),
    0.25: p(13, 0, 1),
    0.4: p(13, 0, 1),
    0.65: p(13, 0, 1),
    1.0: p(13, 0, 1),
    1.5: p(13, 0, 1),
    2.5: p(13, 1, 2),
    4.0: p(13, 2, 3),
    6.5: p(13, 3, 4),
    10.0: p(13, 5, 6)
  },
  F: {
    0.065: p(20, 0, 1),
    0.1: p(20, 0, 1),
    0.15: p(20, 0, 1),
    0.25: p(20, 0, 1),
    0.4: p(20, 0, 1),
    0.65: p(20, 0, 1),
    1.0: p(20, 0, 1),
    1.5: p(20, 1, 2),
    2.5: p(20, 2, 3),
    4.0: p(20, 3, 4),
    6.5: p(20, 5, 6),
    10.0: p(20, 7, 8)
  },
  G: {
    0.065: p(32, 0, 1),
    0.1: p(32, 0, 1),
    0.15: p(32, 0, 1),
    0.25: p(32, 0, 1),
    0.4: p(32, 0, 1),
    0.65: p(32, 0, 1),
    1.0: p(32, 1, 2),
    1.5: p(32, 2, 3),
    2.5: p(32, 3, 4),
    4.0: p(32, 5, 6),
    6.5: p(32, 7, 8),
    10.0: p(32, 10, 11)
  },
  H: {
    0.065: p(50, 0, 1),
    0.1: p(50, 0, 1),
    0.15: p(50, 0, 1),
    0.25: p(50, 0, 1),
    0.4: p(50, 0, 1),
    0.65: p(50, 1, 2),
    1.0: p(50, 2, 3),
    1.5: p(50, 3, 4),
    2.5: p(50, 5, 6),
    4.0: p(50, 7, 8),
    6.5: p(50, 10, 11),
    10.0: p(50, 14, 15)
  },
  J: {
    0.065: p(80, 0, 1),
    0.1: p(80, 0, 1),
    0.15: p(80, 0, 1),
    0.25: p(80, 0, 1),
    0.4: p(80, 1, 2),
    0.65: p(80, 2, 3),
    1.0: p(80, 3, 4),
    1.5: p(80, 5, 6),
    2.5: p(80, 7, 8),
    4.0: p(80, 10, 11),
    6.5: p(80, 14, 15),
    10.0: p(80, 21, 22)
  },
  K: {
    0.065: p(125, 0, 1),
    0.1: p(125, 0, 1),
    0.15: p(125, 0, 1),
    0.25: p(125, 1, 2),
    0.4: p(125, 2, 3),
    0.65: p(125, 3, 4),
    1.0: p(125, 5, 6),
    1.5: p(125, 7, 8),
    2.5: p(125, 10, 11),
    4.0: p(125, 14, 15),
    6.5: p(125, 21, 22),
    10.0: p(125, 21, 22)
  },
  L: {
    0.065: p(200, 0, 1),
    0.1: p(200, 0, 1),
    0.15: p(200, 1, 2),
    0.25: p(200, 2, 3),
    0.4: p(200, 3, 4),
    0.65: p(200, 5, 6),
    1.0: p(200, 7, 8),
    1.5: p(200, 10, 11),
    2.5: p(200, 14, 15),
    4.0: p(200, 21, 22),
    6.5: p(200, 21, 22),
    10.0: p(200, 21, 22)
  },
  M: {
    0.065: p(315, 0, 1),
    0.1: p(315, 1, 2),
    0.15: p(315, 2, 3),
    0.25: p(315, 3, 4),
    0.4: p(315, 5, 6),
    0.65: p(315, 7, 8),
    1.0: p(315, 10, 11),
    1.5: p(315, 14, 15),
    2.5: p(315, 21, 22),
    4.0: p(315, 21, 22),
    6.5: p(315, 21, 22),
    10.0: p(315, 21, 22)
  },
  N: {
    0.065: p(500, 1, 2),
    0.1: p(500, 2, 3),
    0.15: p(500, 3, 4),
    0.25: p(500, 5, 6),
    0.4: p(500, 7, 8),
    0.65: p(500, 10, 11),
    1.0: p(500, 14, 15),
    1.5: p(500, 21, 22),
    2.5: p(500, 21, 22),
    4.0: p(500, 21, 22),
    6.5: p(500, 21, 22),
    10.0: p(500, 21, 22)
  },
  P: {
    0.065: p(800, 2, 3),
    0.1: p(800, 3, 4),
    0.15: p(800, 5, 6),
    0.25: p(800, 7, 8),
    0.4: p(800, 10, 11),
    0.65: p(800, 14, 15),
    1.0: p(800, 21, 22),
    1.5: p(800, 21, 22),
    2.5: p(800, 21, 22),
    4.0: p(800, 21, 22),
    6.5: p(800, 21, 22),
    10.0: p(800, 21, 22)
  },
  Q: {
    0.065: p(1250, 3, 4),
    0.1: p(1250, 5, 6),
    0.15: p(1250, 7, 8),
    0.25: p(1250, 10, 11),
    0.4: p(1250, 14, 15),
    0.65: p(1250, 21, 22),
    1.0: p(1250, 21, 22),
    1.5: p(1250, 21, 22),
    2.5: p(1250, 21, 22),
    4.0: p(1250, 21, 22),
    6.5: p(1250, 21, 22),
    10.0: p(1250, 21, 22)
  },
  R: {
    0.065: p(2000, 5, 6),
    0.1: p(2000, 7, 8),
    0.15: p(2000, 10, 11),
    0.25: p(2000, 14, 15),
    0.4: p(2000, 21, 22),
    0.65: p(2000, 21, 22),
    1.0: p(2000, 21, 22),
    1.5: p(2000, 21, 22),
    2.5: p(2000, 21, 22),
    4.0: p(2000, 21, 22),
    6.5: p(2000, 21, 22),
    10.0: p(2000, 21, 22)
  }
};

/**
 * Z1.4 Table II-B — Tightened. Same sample sizes as Normal, stricter Ac/Re.
 */
const Z14_SINGLE_TIGHTENED: SeverityBlock = {
  A: {
    0.065: p(2, 0, 1),
    0.1: p(2, 0, 1),
    0.15: p(2, 0, 1),
    0.25: p(2, 0, 1),
    0.4: p(2, 0, 1),
    0.65: p(2, 0, 1),
    1.0: p(2, 0, 1),
    1.5: p(2, 0, 1),
    2.5: p(2, 0, 1),
    4.0: p(2, 0, 1),
    6.5: p(2, 0, 1),
    10.0: p(2, 0, 1)
  },
  B: {
    0.065: p(3, 0, 1),
    0.1: p(3, 0, 1),
    0.15: p(3, 0, 1),
    0.25: p(3, 0, 1),
    0.4: p(3, 0, 1),
    0.65: p(3, 0, 1),
    1.0: p(3, 0, 1),
    1.5: p(3, 0, 1),
    2.5: p(3, 0, 1),
    4.0: p(3, 0, 1),
    6.5: p(3, 0, 1),
    10.0: p(3, 1, 2)
  },
  C: {
    0.065: p(5, 0, 1),
    0.1: p(5, 0, 1),
    0.15: p(5, 0, 1),
    0.25: p(5, 0, 1),
    0.4: p(5, 0, 1),
    0.65: p(5, 0, 1),
    1.0: p(5, 0, 1),
    1.5: p(5, 0, 1),
    2.5: p(5, 0, 1),
    4.0: p(5, 0, 1),
    6.5: p(5, 1, 2),
    10.0: p(5, 1, 2)
  },
  D: {
    0.065: p(8, 0, 1),
    0.1: p(8, 0, 1),
    0.15: p(8, 0, 1),
    0.25: p(8, 0, 1),
    0.4: p(8, 0, 1),
    0.65: p(8, 0, 1),
    1.0: p(8, 0, 1),
    1.5: p(8, 0, 1),
    2.5: p(8, 0, 1),
    4.0: p(8, 1, 2),
    6.5: p(8, 1, 2),
    10.0: p(8, 2, 3)
  },
  E: {
    0.065: p(13, 0, 1),
    0.1: p(13, 0, 1),
    0.15: p(13, 0, 1),
    0.25: p(13, 0, 1),
    0.4: p(13, 0, 1),
    0.65: p(13, 0, 1),
    1.0: p(13, 0, 1),
    1.5: p(13, 0, 1),
    2.5: p(13, 1, 2),
    4.0: p(13, 1, 2),
    6.5: p(13, 2, 3),
    10.0: p(13, 3, 4)
  },
  F: {
    0.065: p(20, 0, 1),
    0.1: p(20, 0, 1),
    0.15: p(20, 0, 1),
    0.25: p(20, 0, 1),
    0.4: p(20, 0, 1),
    0.65: p(20, 0, 1),
    1.0: p(20, 0, 1),
    1.5: p(20, 1, 2),
    2.5: p(20, 1, 2),
    4.0: p(20, 2, 3),
    6.5: p(20, 3, 4),
    10.0: p(20, 5, 6)
  },
  G: {
    0.065: p(32, 0, 1),
    0.1: p(32, 0, 1),
    0.15: p(32, 0, 1),
    0.25: p(32, 0, 1),
    0.4: p(32, 0, 1),
    0.65: p(32, 0, 1),
    1.0: p(32, 1, 2),
    1.5: p(32, 1, 2),
    2.5: p(32, 2, 3),
    4.0: p(32, 3, 4),
    6.5: p(32, 5, 6),
    10.0: p(32, 8, 9)
  },
  H: {
    0.065: p(50, 0, 1),
    0.1: p(50, 0, 1),
    0.15: p(50, 0, 1),
    0.25: p(50, 0, 1),
    0.4: p(50, 0, 1),
    0.65: p(50, 1, 2),
    1.0: p(50, 1, 2),
    1.5: p(50, 2, 3),
    2.5: p(50, 3, 4),
    4.0: p(50, 5, 6),
    6.5: p(50, 8, 9),
    10.0: p(50, 12, 13)
  },
  J: {
    0.065: p(80, 0, 1),
    0.1: p(80, 0, 1),
    0.15: p(80, 0, 1),
    0.25: p(80, 0, 1),
    0.4: p(80, 1, 2),
    0.65: p(80, 1, 2),
    1.0: p(80, 2, 3),
    1.5: p(80, 3, 4),
    2.5: p(80, 5, 6),
    4.0: p(80, 8, 9),
    6.5: p(80, 12, 13),
    10.0: p(80, 18, 19)
  },
  K: {
    0.065: p(125, 0, 1),
    0.1: p(125, 0, 1),
    0.15: p(125, 0, 1),
    0.25: p(125, 1, 2),
    0.4: p(125, 1, 2),
    0.65: p(125, 2, 3),
    1.0: p(125, 3, 4),
    1.5: p(125, 5, 6),
    2.5: p(125, 8, 9),
    4.0: p(125, 12, 13),
    6.5: p(125, 18, 19),
    10.0: p(125, 18, 19)
  },
  L: {
    0.065: p(200, 0, 1),
    0.1: p(200, 0, 1),
    0.15: p(200, 1, 2),
    0.25: p(200, 1, 2),
    0.4: p(200, 2, 3),
    0.65: p(200, 3, 4),
    1.0: p(200, 5, 6),
    1.5: p(200, 8, 9),
    2.5: p(200, 12, 13),
    4.0: p(200, 18, 19),
    6.5: p(200, 18, 19),
    10.0: p(200, 18, 19)
  },
  M: {
    0.065: p(315, 0, 1),
    0.1: p(315, 1, 2),
    0.15: p(315, 1, 2),
    0.25: p(315, 2, 3),
    0.4: p(315, 3, 4),
    0.65: p(315, 5, 6),
    1.0: p(315, 8, 9),
    1.5: p(315, 12, 13),
    2.5: p(315, 18, 19),
    4.0: p(315, 18, 19),
    6.5: p(315, 18, 19),
    10.0: p(315, 18, 19)
  },
  N: {
    0.065: p(500, 1, 2),
    0.1: p(500, 1, 2),
    0.15: p(500, 2, 3),
    0.25: p(500, 3, 4),
    0.4: p(500, 5, 6),
    0.65: p(500, 8, 9),
    1.0: p(500, 12, 13),
    1.5: p(500, 18, 19),
    2.5: p(500, 18, 19),
    4.0: p(500, 18, 19),
    6.5: p(500, 18, 19),
    10.0: p(500, 18, 19)
  },
  P: {
    0.065: p(800, 1, 2),
    0.1: p(800, 2, 3),
    0.15: p(800, 3, 4),
    0.25: p(800, 5, 6),
    0.4: p(800, 8, 9),
    0.65: p(800, 12, 13),
    1.0: p(800, 18, 19),
    1.5: p(800, 18, 19),
    2.5: p(800, 18, 19),
    4.0: p(800, 18, 19),
    6.5: p(800, 18, 19),
    10.0: p(800, 18, 19)
  },
  Q: {
    0.065: p(1250, 2, 3),
    0.1: p(1250, 3, 4),
    0.15: p(1250, 5, 6),
    0.25: p(1250, 8, 9),
    0.4: p(1250, 12, 13),
    0.65: p(1250, 18, 19),
    1.0: p(1250, 18, 19),
    1.5: p(1250, 18, 19),
    2.5: p(1250, 18, 19),
    4.0: p(1250, 18, 19),
    6.5: p(1250, 18, 19),
    10.0: p(1250, 18, 19)
  },
  R: {
    0.065: p(2000, 3, 4),
    0.1: p(2000, 5, 6),
    0.15: p(2000, 8, 9),
    0.25: p(2000, 12, 13),
    0.4: p(2000, 18, 19),
    0.65: p(2000, 18, 19),
    1.0: p(2000, 18, 19),
    1.5: p(2000, 18, 19),
    2.5: p(2000, 18, 19),
    4.0: p(2000, 18, 19),
    6.5: p(2000, 18, 19),
    10.0: p(2000, 18, 19)
  }
};

/**
 * Z1.4 Table II-C — Reduced. Smaller sample sizes.
 */
const Z14_SINGLE_REDUCED: SeverityBlock = {
  A: {
    0.065: p(2, 0, 1),
    0.1: p(2, 0, 1),
    0.15: p(2, 0, 1),
    0.25: p(2, 0, 1),
    0.4: p(2, 0, 1),
    0.65: p(2, 0, 1),
    1.0: p(2, 0, 1),
    1.5: p(2, 0, 1),
    2.5: p(2, 0, 1),
    4.0: p(2, 0, 1),
    6.5: p(2, 0, 1),
    10.0: p(2, 0, 2)
  },
  B: {
    0.065: p(2, 0, 1),
    0.1: p(2, 0, 1),
    0.15: p(2, 0, 1),
    0.25: p(2, 0, 1),
    0.4: p(2, 0, 1),
    0.65: p(2, 0, 1),
    1.0: p(2, 0, 1),
    1.5: p(2, 0, 1),
    2.5: p(2, 0, 1),
    4.0: p(2, 0, 1),
    6.5: p(2, 0, 1),
    10.0: p(2, 0, 2)
  },
  C: {
    0.065: p(2, 0, 1),
    0.1: p(2, 0, 1),
    0.15: p(2, 0, 1),
    0.25: p(2, 0, 1),
    0.4: p(2, 0, 1),
    0.65: p(2, 0, 1),
    1.0: p(2, 0, 1),
    1.5: p(2, 0, 1),
    2.5: p(2, 0, 1),
    4.0: p(2, 0, 1),
    6.5: p(2, 0, 2),
    10.0: p(2, 1, 3)
  },
  D: {
    0.065: p(3, 0, 1),
    0.1: p(3, 0, 1),
    0.15: p(3, 0, 1),
    0.25: p(3, 0, 1),
    0.4: p(3, 0, 1),
    0.65: p(3, 0, 1),
    1.0: p(3, 0, 1),
    1.5: p(3, 0, 1),
    2.5: p(3, 0, 1),
    4.0: p(3, 0, 2),
    6.5: p(3, 1, 3),
    10.0: p(3, 1, 4)
  },
  E: {
    0.065: p(5, 0, 1),
    0.1: p(5, 0, 1),
    0.15: p(5, 0, 1),
    0.25: p(5, 0, 1),
    0.4: p(5, 0, 1),
    0.65: p(5, 0, 1),
    1.0: p(5, 0, 1),
    1.5: p(5, 0, 1),
    2.5: p(5, 0, 2),
    4.0: p(5, 1, 3),
    6.5: p(5, 1, 4),
    10.0: p(5, 2, 5)
  },
  F: {
    0.065: p(8, 0, 1),
    0.1: p(8, 0, 1),
    0.15: p(8, 0, 1),
    0.25: p(8, 0, 1),
    0.4: p(8, 0, 1),
    0.65: p(8, 0, 1),
    1.0: p(8, 0, 1),
    1.5: p(8, 0, 2),
    2.5: p(8, 1, 3),
    4.0: p(8, 1, 4),
    6.5: p(8, 2, 5),
    10.0: p(8, 3, 6)
  },
  G: {
    0.065: p(13, 0, 1),
    0.1: p(13, 0, 1),
    0.15: p(13, 0, 1),
    0.25: p(13, 0, 1),
    0.4: p(13, 0, 1),
    0.65: p(13, 0, 1),
    1.0: p(13, 0, 2),
    1.5: p(13, 1, 3),
    2.5: p(13, 1, 4),
    4.0: p(13, 2, 5),
    6.5: p(13, 3, 6),
    10.0: p(13, 5, 8)
  },
  H: {
    0.065: p(20, 0, 1),
    0.1: p(20, 0, 1),
    0.15: p(20, 0, 1),
    0.25: p(20, 0, 1),
    0.4: p(20, 0, 1),
    0.65: p(20, 0, 2),
    1.0: p(20, 1, 3),
    1.5: p(20, 1, 4),
    2.5: p(20, 2, 5),
    4.0: p(20, 3, 6),
    6.5: p(20, 5, 8),
    10.0: p(20, 7, 10)
  },
  J: {
    0.065: p(32, 0, 1),
    0.1: p(32, 0, 1),
    0.15: p(32, 0, 1),
    0.25: p(32, 0, 1),
    0.4: p(32, 0, 2),
    0.65: p(32, 1, 3),
    1.0: p(32, 1, 4),
    1.5: p(32, 2, 5),
    2.5: p(32, 3, 6),
    4.0: p(32, 5, 8),
    6.5: p(32, 7, 10),
    10.0: p(32, 10, 13)
  },
  K: {
    0.065: p(50, 0, 1),
    0.1: p(50, 0, 1),
    0.15: p(50, 0, 1),
    0.25: p(50, 0, 2),
    0.4: p(50, 1, 3),
    0.65: p(50, 1, 4),
    1.0: p(50, 2, 5),
    1.5: p(50, 3, 6),
    2.5: p(50, 5, 8),
    4.0: p(50, 7, 10),
    6.5: p(50, 10, 13),
    10.0: p(50, 14, 17)
  },
  L: {
    0.065: p(80, 0, 1),
    0.1: p(80, 0, 1),
    0.15: p(80, 0, 2),
    0.25: p(80, 1, 3),
    0.4: p(80, 1, 4),
    0.65: p(80, 2, 5),
    1.0: p(80, 3, 6),
    1.5: p(80, 5, 8),
    2.5: p(80, 7, 10),
    4.0: p(80, 10, 13),
    6.5: p(80, 14, 17),
    10.0: p(80, 21, 24)
  },
  M: {
    0.065: p(125, 0, 1),
    0.1: p(125, 0, 2),
    0.15: p(125, 1, 3),
    0.25: p(125, 1, 4),
    0.4: p(125, 2, 5),
    0.65: p(125, 3, 6),
    1.0: p(125, 5, 8),
    1.5: p(125, 7, 10),
    2.5: p(125, 10, 13),
    4.0: p(125, 14, 17),
    6.5: p(125, 21, 24),
    10.0: p(125, 21, 24)
  },
  N: {
    0.065: p(200, 0, 2),
    0.1: p(200, 1, 3),
    0.15: p(200, 1, 4),
    0.25: p(200, 2, 5),
    0.4: p(200, 3, 6),
    0.65: p(200, 5, 8),
    1.0: p(200, 7, 10),
    1.5: p(200, 10, 13),
    2.5: p(200, 14, 17),
    4.0: p(200, 21, 24),
    6.5: p(200, 21, 24),
    10.0: p(200, 21, 24)
  },
  P: {
    0.065: p(315, 1, 3),
    0.1: p(315, 1, 4),
    0.15: p(315, 2, 5),
    0.25: p(315, 3, 6),
    0.4: p(315, 5, 8),
    0.65: p(315, 7, 10),
    1.0: p(315, 10, 13),
    1.5: p(315, 14, 17),
    2.5: p(315, 21, 24),
    4.0: p(315, 21, 24),
    6.5: p(315, 21, 24),
    10.0: p(315, 21, 24)
  },
  Q: {
    0.065: p(500, 1, 4),
    0.1: p(500, 2, 5),
    0.15: p(500, 3, 6),
    0.25: p(500, 5, 8),
    0.4: p(500, 7, 10),
    0.65: p(500, 10, 13),
    1.0: p(500, 14, 17),
    1.5: p(500, 21, 24),
    2.5: p(500, 21, 24),
    4.0: p(500, 21, 24),
    6.5: p(500, 21, 24),
    10.0: p(500, 21, 24)
  },
  R: {
    0.065: p(800, 2, 5),
    0.1: p(800, 3, 6),
    0.15: p(800, 5, 8),
    0.25: p(800, 7, 10),
    0.4: p(800, 10, 13),
    0.65: p(800, 14, 17),
    1.0: p(800, 21, 24),
    1.5: p(800, 21, 24),
    2.5: p(800, 21, 24),
    4.0: p(800, 21, 24),
    6.5: p(800, 21, 24),
    10.0: p(800, 21, 24)
  }
};

function p(n: number, Ac: number, Re: number): SinglePlanCell {
  return { n, Ac, Re };
}

// ---------------------------------------------------------------------------
// Multi-standard registry
// ISO 2859-1 cells currently equal Z1.4; divergences should override here.
// ---------------------------------------------------------------------------

type StandardData = {
  codeLetterTable: CodeLetterRow[];
  normal: SeverityBlock;
  tightened: SeverityBlock;
  reduced: SeverityBlock;
};

export const SAMPLING_STANDARDS: Record<SamplingStandard, StandardData> = {
  ANSI_Z1_4: {
    codeLetterTable: CODE_LETTER_TABLE,
    normal: Z14_SINGLE_NORMAL,
    tightened: Z14_SINGLE_TIGHTENED,
    reduced: Z14_SINGLE_REDUCED
  },
  // ISO 2859-1 inherits identical tables; override individual cells here when
  // a revision of the standard diverges from Z1.4.
  ISO_2859_1: {
    codeLetterTable: CODE_LETTER_TABLE,
    normal: Z14_SINGLE_NORMAL,
    tightened: Z14_SINGLE_TIGHTENED,
    reduced: Z14_SINGLE_REDUCED
  }
};

// ---------------------------------------------------------------------------
// Sampling engine
// ---------------------------------------------------------------------------

export type SamplingPlanInput = {
  type: SamplingPlanType;
  sampleSize?: number | null;
  percentage?: number | null;
  aql?: number | null;
  inspectionLevel?: InspectionLevel | null;
  severity?: InspectionSeverity | null;
};

export type SamplingResult = {
  sampleSize: number;
  acceptance: number;
  rejection: number;
  codeLetter: string | null;
  standard: SamplingStandard;
};

export function getCodeLetter(
  standard: SamplingStandard,
  lotSize: number,
  level: InspectionLevel
): string | null {
  const rows = SAMPLING_STANDARDS[standard].codeLetterTable;
  const row = rows.find(
    (r) => lotSize >= r.range.min && lotSize <= r.range.max
  );
  return row?.levels[level] ?? null;
}

function getSeverityBlock(
  standard: SamplingStandard,
  severity: InspectionSeverity
): SeverityBlock {
  const data = SAMPLING_STANDARDS[standard];
  switch (severity) {
    case "Tightened":
      return data.tightened;
    case "Reduced":
      return data.reduced;
    case "Normal":
    default:
      return data.normal;
  }
}

export function resolveSamplingPlan(
  plan: SamplingPlanInput,
  lotSize: number,
  standard: SamplingStandard
): SamplingResult {
  const safeLot = Math.max(1, Math.floor(lotSize));

  if (plan.type === "All") {
    return {
      sampleSize: safeLot,
      acceptance: 0,
      rejection: 1,
      codeLetter: null,
      standard
    };
  }

  if (plan.type === "First") {
    const n = Math.min(plan.sampleSize ?? 1, safeLot);
    return {
      sampleSize: Math.max(1, n),
      acceptance: 0,
      rejection: 1,
      codeLetter: null,
      standard
    };
  }

  if (plan.type === "Percentage") {
    const pct = Math.max(0, Math.min(100, plan.percentage ?? 100));
    const n = Math.max(1, Math.min(safeLot, Math.ceil((safeLot * pct) / 100)));
    return {
      sampleSize: n,
      acceptance: 0,
      rejection: 1,
      codeLetter: null,
      standard
    };
  }

  // AQL
  const level = plan.inspectionLevel ?? "II";
  const severity = plan.severity ?? "Normal";
  const aql = plan.aql ?? 1.0;
  const letter = getCodeLetter(standard, safeLot, level);
  if (!letter) {
    return {
      sampleSize: safeLot,
      acceptance: 0,
      rejection: 1,
      codeLetter: null,
      standard
    };
  }
  const cell = getSeverityBlock(standard, severity)[letter]?.[aql];
  if (!cell) {
    return {
      sampleSize: safeLot,
      acceptance: 0,
      rejection: 1,
      codeLetter: letter,
      standard
    };
  }
  // If the computed sample exceeds the lot, inspect everything.
  if (cell.n >= safeLot) {
    return {
      sampleSize: safeLot,
      acceptance: cell.Ac,
      rejection: cell.Re,
      codeLetter: letter,
      standard
    };
  }
  return {
    sampleSize: cell.n,
    acceptance: cell.Ac,
    rejection: cell.Re,
    codeLetter: letter,
    standard
  };
}

export type FeatureSamplingRule = {
  samplingPlanType?: SamplingPlanType | null;
  samplingSampleSize?: number | null;
  samplingPercentage?: number | null;
  samplingAql?: number | null;
  samplingInspectionLevel?: InspectionLevel | null;
  samplingSeverity?: InspectionSeverity | null;
};

// Per-feature resolution: a feature's own rule wins, else the inspection
// document's default rule, else 100% inspection.
export function resolveFeatureSamplingPlan(
  feature: FeatureSamplingRule | null | undefined,
  defaultPlan: SamplingPlanInput | null | undefined,
  lotSize: number,
  standard: SamplingStandard
): SamplingResult {
  const plan: SamplingPlanInput = feature?.samplingPlanType
    ? {
        type: feature.samplingPlanType,
        sampleSize: feature.samplingSampleSize ?? undefined,
        percentage: feature.samplingPercentage ?? undefined,
        aql: feature.samplingAql ?? undefined,
        inspectionLevel: feature.samplingInspectionLevel ?? undefined,
        severity: feature.samplingSeverity ?? undefined
      }
    : (defaultPlan ?? { type: "All" });
  return resolveSamplingPlan(plan, lotSize, standard);
}
