/**
 * Attribute sampling engine (edge-runtime copy).
 *
 * Mirrors apps/erp/app/modules/quality/samplingStandards.ts. Kept in sync
 * manually — these are the Z1.4 / ISO 2859-1 table constants and the pure
 * resolver used by post-receipt to snapshot a plan onto each lot.
 */

export type SamplingStandard = "ANSI_Z1_4" | "ISO_2859_1";
export type SamplingPlanType = "All" | "First" | "Percentage" | "AQL";
export type InspectionLevel = "I" | "II" | "III" | "S1" | "S2" | "S3" | "S4";
export type InspectionSeverity = "Normal" | "Tightened" | "Reduced";

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

type LotRange = { min: number; max: number };
type CodeLetterRow = {
  range: LotRange;
  levels: Record<InspectionLevel, string>;
};
type SinglePlanCell = { n: number; Ac: number; Re: number };
type SeverityBlock = Record<string, Record<number, SinglePlanCell>>;

const CODE_LETTER_TABLE: CodeLetterRow[] = [
  { range: r(2, 8),       levels: l("A","A","A","A","A","A","B") },
  { range: r(9, 15),      levels: l("A","A","A","A","A","B","C") },
  { range: r(16, 25),     levels: l("A","A","B","B","B","C","D") },
  { range: r(26, 50),     levels: l("A","B","B","C","C","D","E") },
  { range: r(51, 90),     levels: l("B","B","C","C","C","E","F") },
  { range: r(91, 150),    levels: l("B","B","C","D","D","F","G") },
  { range: r(151, 280),   levels: l("B","C","D","E","E","G","H") },
  { range: r(281, 500),   levels: l("B","C","D","E","F","H","J") },
  { range: r(501, 1200),  levels: l("C","C","E","F","G","J","K") },
  { range: r(1201, 3200), levels: l("C","D","E","G","H","K","L") },
  { range: r(3201, 10000),levels: l("C","D","F","G","J","L","M") },
  { range: r(10001, 35000), levels: l("C","D","F","H","K","M","N") },
  { range: r(35001, 150000), levels: l("D","E","G","J","L","N","P") },
  { range: r(150001, 500000), levels: l("D","E","G","J","M","P","Q") },
  { range: r(500001, Number.MAX_SAFE_INTEGER), levels: l("D","E","H","K","N","Q","R") }
];

function r(min: number, max: number): LotRange {
  return { min, max };
}
function l(
  s1: string, s2: string, s3: string, s4: string,
  i: string, ii: string, iii: string
): Record<InspectionLevel, string> {
  return { S1: s1, S2: s2, S3: s3, S4: s4, I: i, II: ii, III: iii };
}
function p(n: number, Ac: number, Re: number): SinglePlanCell {
  return { n, Ac, Re };
}

const SINGLE_NORMAL: SeverityBlock = {
  A: { 0.065: p(2,0,1), 0.1: p(2,0,1), 0.15: p(2,0,1), 0.25: p(2,0,1), 0.4: p(2,0,1), 0.65: p(2,0,1), 1.0: p(2,0,1), 1.5: p(2,0,1), 2.5: p(2,0,1), 4.0: p(2,0,1), 6.5: p(2,0,1), 10.0: p(2,0,1) },
  B: { 0.065: p(3,0,1), 0.1: p(3,0,1), 0.15: p(3,0,1), 0.25: p(3,0,1), 0.4: p(3,0,1), 0.65: p(3,0,1), 1.0: p(3,0,1), 1.5: p(3,0,1), 2.5: p(3,0,1), 4.0: p(3,0,1), 6.5: p(3,0,1), 10.0: p(3,1,2) },
  C: { 0.065: p(5,0,1), 0.1: p(5,0,1), 0.15: p(5,0,1), 0.25: p(5,0,1), 0.4: p(5,0,1), 0.65: p(5,0,1), 1.0: p(5,0,1), 1.5: p(5,0,1), 2.5: p(5,0,1), 4.0: p(5,0,1), 6.5: p(5,1,2), 10.0: p(5,2,3) },
  D: { 0.065: p(8,0,1), 0.1: p(8,0,1), 0.15: p(8,0,1), 0.25: p(8,0,1), 0.4: p(8,0,1), 0.65: p(8,0,1), 1.0: p(8,0,1), 1.5: p(8,0,1), 2.5: p(8,0,1), 4.0: p(8,1,2), 6.5: p(8,2,3), 10.0: p(8,3,4) },
  E: { 0.065: p(13,0,1), 0.1: p(13,0,1), 0.15: p(13,0,1), 0.25: p(13,0,1), 0.4: p(13,0,1), 0.65: p(13,0,1), 1.0: p(13,0,1), 1.5: p(13,0,1), 2.5: p(13,1,2), 4.0: p(13,2,3), 6.5: p(13,3,4), 10.0: p(13,5,6) },
  F: { 0.065: p(20,0,1), 0.1: p(20,0,1), 0.15: p(20,0,1), 0.25: p(20,0,1), 0.4: p(20,0,1), 0.65: p(20,0,1), 1.0: p(20,0,1), 1.5: p(20,1,2), 2.5: p(20,2,3), 4.0: p(20,3,4), 6.5: p(20,5,6), 10.0: p(20,7,8) },
  G: { 0.065: p(32,0,1), 0.1: p(32,0,1), 0.15: p(32,0,1), 0.25: p(32,0,1), 0.4: p(32,0,1), 0.65: p(32,0,1), 1.0: p(32,1,2), 1.5: p(32,2,3), 2.5: p(32,3,4), 4.0: p(32,5,6), 6.5: p(32,7,8), 10.0: p(32,10,11) },
  H: { 0.065: p(50,0,1), 0.1: p(50,0,1), 0.15: p(50,0,1), 0.25: p(50,0,1), 0.4: p(50,0,1), 0.65: p(50,1,2), 1.0: p(50,2,3), 1.5: p(50,3,4), 2.5: p(50,5,6), 4.0: p(50,7,8), 6.5: p(50,10,11), 10.0: p(50,14,15) },
  J: { 0.065: p(80,0,1), 0.1: p(80,0,1), 0.15: p(80,0,1), 0.25: p(80,0,1), 0.4: p(80,1,2), 0.65: p(80,2,3), 1.0: p(80,3,4), 1.5: p(80,5,6), 2.5: p(80,7,8), 4.0: p(80,10,11), 6.5: p(80,14,15), 10.0: p(80,21,22) },
  K: { 0.065: p(125,0,1), 0.1: p(125,0,1), 0.15: p(125,0,1), 0.25: p(125,1,2), 0.4: p(125,2,3), 0.65: p(125,3,4), 1.0: p(125,5,6), 1.5: p(125,7,8), 2.5: p(125,10,11), 4.0: p(125,14,15), 6.5: p(125,21,22), 10.0: p(125,21,22) },
  L: { 0.065: p(200,0,1), 0.1: p(200,0,1), 0.15: p(200,1,2), 0.25: p(200,2,3), 0.4: p(200,3,4), 0.65: p(200,5,6), 1.0: p(200,7,8), 1.5: p(200,10,11), 2.5: p(200,14,15), 4.0: p(200,21,22), 6.5: p(200,21,22), 10.0: p(200,21,22) },
  M: { 0.065: p(315,0,1), 0.1: p(315,1,2), 0.15: p(315,2,3), 0.25: p(315,3,4), 0.4: p(315,5,6), 0.65: p(315,7,8), 1.0: p(315,10,11), 1.5: p(315,14,15), 2.5: p(315,21,22), 4.0: p(315,21,22), 6.5: p(315,21,22), 10.0: p(315,21,22) },
  N: { 0.065: p(500,1,2), 0.1: p(500,2,3), 0.15: p(500,3,4), 0.25: p(500,5,6), 0.4: p(500,7,8), 0.65: p(500,10,11), 1.0: p(500,14,15), 1.5: p(500,21,22), 2.5: p(500,21,22), 4.0: p(500,21,22), 6.5: p(500,21,22), 10.0: p(500,21,22) },
  P: { 0.065: p(800,2,3), 0.1: p(800,3,4), 0.15: p(800,5,6), 0.25: p(800,7,8), 0.4: p(800,10,11), 0.65: p(800,14,15), 1.0: p(800,21,22), 1.5: p(800,21,22), 2.5: p(800,21,22), 4.0: p(800,21,22), 6.5: p(800,21,22), 10.0: p(800,21,22) },
  Q: { 0.065: p(1250,3,4), 0.1: p(1250,5,6), 0.15: p(1250,7,8), 0.25: p(1250,10,11), 0.4: p(1250,14,15), 0.65: p(1250,21,22), 1.0: p(1250,21,22), 1.5: p(1250,21,22), 2.5: p(1250,21,22), 4.0: p(1250,21,22), 6.5: p(1250,21,22), 10.0: p(1250,21,22) },
  R: { 0.065: p(2000,5,6), 0.1: p(2000,7,8), 0.15: p(2000,10,11), 0.25: p(2000,14,15), 0.4: p(2000,21,22), 0.65: p(2000,21,22), 1.0: p(2000,21,22), 1.5: p(2000,21,22), 2.5: p(2000,21,22), 4.0: p(2000,21,22), 6.5: p(2000,21,22), 10.0: p(2000,21,22) }
};

const SINGLE_TIGHTENED: SeverityBlock = {
  A: { 0.065: p(2,0,1), 0.1: p(2,0,1), 0.15: p(2,0,1), 0.25: p(2,0,1), 0.4: p(2,0,1), 0.65: p(2,0,1), 1.0: p(2,0,1), 1.5: p(2,0,1), 2.5: p(2,0,1), 4.0: p(2,0,1), 6.5: p(2,0,1), 10.0: p(2,0,1) },
  B: { 0.065: p(3,0,1), 0.1: p(3,0,1), 0.15: p(3,0,1), 0.25: p(3,0,1), 0.4: p(3,0,1), 0.65: p(3,0,1), 1.0: p(3,0,1), 1.5: p(3,0,1), 2.5: p(3,0,1), 4.0: p(3,0,1), 6.5: p(3,0,1), 10.0: p(3,1,2) },
  C: { 0.065: p(5,0,1), 0.1: p(5,0,1), 0.15: p(5,0,1), 0.25: p(5,0,1), 0.4: p(5,0,1), 0.65: p(5,0,1), 1.0: p(5,0,1), 1.5: p(5,0,1), 2.5: p(5,0,1), 4.0: p(5,0,1), 6.5: p(5,1,2), 10.0: p(5,1,2) },
  D: { 0.065: p(8,0,1), 0.1: p(8,0,1), 0.15: p(8,0,1), 0.25: p(8,0,1), 0.4: p(8,0,1), 0.65: p(8,0,1), 1.0: p(8,0,1), 1.5: p(8,0,1), 2.5: p(8,0,1), 4.0: p(8,1,2), 6.5: p(8,1,2), 10.0: p(8,2,3) },
  E: { 0.065: p(13,0,1), 0.1: p(13,0,1), 0.15: p(13,0,1), 0.25: p(13,0,1), 0.4: p(13,0,1), 0.65: p(13,0,1), 1.0: p(13,0,1), 1.5: p(13,0,1), 2.5: p(13,1,2), 4.0: p(13,1,2), 6.5: p(13,2,3), 10.0: p(13,3,4) },
  F: { 0.065: p(20,0,1), 0.1: p(20,0,1), 0.15: p(20,0,1), 0.25: p(20,0,1), 0.4: p(20,0,1), 0.65: p(20,0,1), 1.0: p(20,0,1), 1.5: p(20,1,2), 2.5: p(20,1,2), 4.0: p(20,2,3), 6.5: p(20,3,4), 10.0: p(20,5,6) },
  G: { 0.065: p(32,0,1), 0.1: p(32,0,1), 0.15: p(32,0,1), 0.25: p(32,0,1), 0.4: p(32,0,1), 0.65: p(32,0,1), 1.0: p(32,1,2), 1.5: p(32,1,2), 2.5: p(32,2,3), 4.0: p(32,3,4), 6.5: p(32,5,6), 10.0: p(32,8,9) },
  H: { 0.065: p(50,0,1), 0.1: p(50,0,1), 0.15: p(50,0,1), 0.25: p(50,0,1), 0.4: p(50,0,1), 0.65: p(50,1,2), 1.0: p(50,1,2), 1.5: p(50,2,3), 2.5: p(50,3,4), 4.0: p(50,5,6), 6.5: p(50,8,9), 10.0: p(50,12,13) },
  J: { 0.065: p(80,0,1), 0.1: p(80,0,1), 0.15: p(80,0,1), 0.25: p(80,0,1), 0.4: p(80,1,2), 0.65: p(80,1,2), 1.0: p(80,2,3), 1.5: p(80,3,4), 2.5: p(80,5,6), 4.0: p(80,8,9), 6.5: p(80,12,13), 10.0: p(80,18,19) },
  K: { 0.065: p(125,0,1), 0.1: p(125,0,1), 0.15: p(125,0,1), 0.25: p(125,1,2), 0.4: p(125,1,2), 0.65: p(125,2,3), 1.0: p(125,3,4), 1.5: p(125,5,6), 2.5: p(125,8,9), 4.0: p(125,12,13), 6.5: p(125,18,19), 10.0: p(125,18,19) },
  L: { 0.065: p(200,0,1), 0.1: p(200,0,1), 0.15: p(200,1,2), 0.25: p(200,1,2), 0.4: p(200,2,3), 0.65: p(200,3,4), 1.0: p(200,5,6), 1.5: p(200,8,9), 2.5: p(200,12,13), 4.0: p(200,18,19), 6.5: p(200,18,19), 10.0: p(200,18,19) },
  M: { 0.065: p(315,0,1), 0.1: p(315,1,2), 0.15: p(315,1,2), 0.25: p(315,2,3), 0.4: p(315,3,4), 0.65: p(315,5,6), 1.0: p(315,8,9), 1.5: p(315,12,13), 2.5: p(315,18,19), 4.0: p(315,18,19), 6.5: p(315,18,19), 10.0: p(315,18,19) },
  N: { 0.065: p(500,1,2), 0.1: p(500,1,2), 0.15: p(500,2,3), 0.25: p(500,3,4), 0.4: p(500,5,6), 0.65: p(500,8,9), 1.0: p(500,12,13), 1.5: p(500,18,19), 2.5: p(500,18,19), 4.0: p(500,18,19), 6.5: p(500,18,19), 10.0: p(500,18,19) },
  P: { 0.065: p(800,1,2), 0.1: p(800,2,3), 0.15: p(800,3,4), 0.25: p(800,5,6), 0.4: p(800,8,9), 0.65: p(800,12,13), 1.0: p(800,18,19), 1.5: p(800,18,19), 2.5: p(800,18,19), 4.0: p(800,18,19), 6.5: p(800,18,19), 10.0: p(800,18,19) },
  Q: { 0.065: p(1250,2,3), 0.1: p(1250,3,4), 0.15: p(1250,5,6), 0.25: p(1250,8,9), 0.4: p(1250,12,13), 0.65: p(1250,18,19), 1.0: p(1250,18,19), 1.5: p(1250,18,19), 2.5: p(1250,18,19), 4.0: p(1250,18,19), 6.5: p(1250,18,19), 10.0: p(1250,18,19) },
  R: { 0.065: p(2000,3,4), 0.1: p(2000,5,6), 0.15: p(2000,8,9), 0.25: p(2000,12,13), 0.4: p(2000,18,19), 0.65: p(2000,18,19), 1.0: p(2000,18,19), 1.5: p(2000,18,19), 2.5: p(2000,18,19), 4.0: p(2000,18,19), 6.5: p(2000,18,19), 10.0: p(2000,18,19) }
};

const SINGLE_REDUCED: SeverityBlock = {
  A: { 0.065: p(2,0,1), 0.1: p(2,0,1), 0.15: p(2,0,1), 0.25: p(2,0,1), 0.4: p(2,0,1), 0.65: p(2,0,1), 1.0: p(2,0,1), 1.5: p(2,0,1), 2.5: p(2,0,1), 4.0: p(2,0,1), 6.5: p(2,0,1), 10.0: p(2,0,2) },
  B: { 0.065: p(2,0,1), 0.1: p(2,0,1), 0.15: p(2,0,1), 0.25: p(2,0,1), 0.4: p(2,0,1), 0.65: p(2,0,1), 1.0: p(2,0,1), 1.5: p(2,0,1), 2.5: p(2,0,1), 4.0: p(2,0,1), 6.5: p(2,0,1), 10.0: p(2,0,2) },
  C: { 0.065: p(2,0,1), 0.1: p(2,0,1), 0.15: p(2,0,1), 0.25: p(2,0,1), 0.4: p(2,0,1), 0.65: p(2,0,1), 1.0: p(2,0,1), 1.5: p(2,0,1), 2.5: p(2,0,1), 4.0: p(2,0,1), 6.5: p(2,0,2), 10.0: p(2,1,3) },
  D: { 0.065: p(3,0,1), 0.1: p(3,0,1), 0.15: p(3,0,1), 0.25: p(3,0,1), 0.4: p(3,0,1), 0.65: p(3,0,1), 1.0: p(3,0,1), 1.5: p(3,0,1), 2.5: p(3,0,1), 4.0: p(3,0,2), 6.5: p(3,1,3), 10.0: p(3,1,4) },
  E: { 0.065: p(5,0,1), 0.1: p(5,0,1), 0.15: p(5,0,1), 0.25: p(5,0,1), 0.4: p(5,0,1), 0.65: p(5,0,1), 1.0: p(5,0,1), 1.5: p(5,0,1), 2.5: p(5,0,2), 4.0: p(5,1,3), 6.5: p(5,1,4), 10.0: p(5,2,5) },
  F: { 0.065: p(8,0,1), 0.1: p(8,0,1), 0.15: p(8,0,1), 0.25: p(8,0,1), 0.4: p(8,0,1), 0.65: p(8,0,1), 1.0: p(8,0,1), 1.5: p(8,0,2), 2.5: p(8,1,3), 4.0: p(8,1,4), 6.5: p(8,2,5), 10.0: p(8,3,6) },
  G: { 0.065: p(13,0,1), 0.1: p(13,0,1), 0.15: p(13,0,1), 0.25: p(13,0,1), 0.4: p(13,0,1), 0.65: p(13,0,1), 1.0: p(13,0,2), 1.5: p(13,1,3), 2.5: p(13,1,4), 4.0: p(13,2,5), 6.5: p(13,3,6), 10.0: p(13,5,8) },
  H: { 0.065: p(20,0,1), 0.1: p(20,0,1), 0.15: p(20,0,1), 0.25: p(20,0,1), 0.4: p(20,0,1), 0.65: p(20,0,2), 1.0: p(20,1,3), 1.5: p(20,1,4), 2.5: p(20,2,5), 4.0: p(20,3,6), 6.5: p(20,5,8), 10.0: p(20,7,10) },
  J: { 0.065: p(32,0,1), 0.1: p(32,0,1), 0.15: p(32,0,1), 0.25: p(32,0,1), 0.4: p(32,0,2), 0.65: p(32,1,3), 1.0: p(32,1,4), 1.5: p(32,2,5), 2.5: p(32,3,6), 4.0: p(32,5,8), 6.5: p(32,7,10), 10.0: p(32,10,13) },
  K: { 0.065: p(50,0,1), 0.1: p(50,0,1), 0.15: p(50,0,1), 0.25: p(50,0,2), 0.4: p(50,1,3), 0.65: p(50,1,4), 1.0: p(50,2,5), 1.5: p(50,3,6), 2.5: p(50,5,8), 4.0: p(50,7,10), 6.5: p(50,10,13), 10.0: p(50,14,17) },
  L: { 0.065: p(80,0,1), 0.1: p(80,0,1), 0.15: p(80,0,2), 0.25: p(80,1,3), 0.4: p(80,1,4), 0.65: p(80,2,5), 1.0: p(80,3,6), 1.5: p(80,5,8), 2.5: p(80,7,10), 4.0: p(80,10,13), 6.5: p(80,14,17), 10.0: p(80,21,24) },
  M: { 0.065: p(125,0,1), 0.1: p(125,0,2), 0.15: p(125,1,3), 0.25: p(125,1,4), 0.4: p(125,2,5), 0.65: p(125,3,6), 1.0: p(125,5,8), 1.5: p(125,7,10), 2.5: p(125,10,13), 4.0: p(125,14,17), 6.5: p(125,21,24), 10.0: p(125,21,24) },
  N: { 0.065: p(200,0,2), 0.1: p(200,1,3), 0.15: p(200,1,4), 0.25: p(200,2,5), 0.4: p(200,3,6), 0.65: p(200,5,8), 1.0: p(200,7,10), 1.5: p(200,10,13), 2.5: p(200,14,17), 4.0: p(200,21,24), 6.5: p(200,21,24), 10.0: p(200,21,24) },
  P: { 0.065: p(315,1,3), 0.1: p(315,1,4), 0.15: p(315,2,5), 0.25: p(315,3,6), 0.4: p(315,5,8), 0.65: p(315,7,10), 1.0: p(315,10,13), 1.5: p(315,14,17), 2.5: p(315,21,24), 4.0: p(315,21,24), 6.5: p(315,21,24), 10.0: p(315,21,24) },
  Q: { 0.065: p(500,1,4), 0.1: p(500,2,5), 0.15: p(500,3,6), 0.25: p(500,5,8), 0.4: p(500,7,10), 0.65: p(500,10,13), 1.0: p(500,14,17), 1.5: p(500,21,24), 2.5: p(500,21,24), 4.0: p(500,21,24), 6.5: p(500,21,24), 10.0: p(500,21,24) },
  R: { 0.065: p(800,2,5), 0.1: p(800,3,6), 0.15: p(800,5,8), 0.25: p(800,7,10), 0.4: p(800,10,13), 0.65: p(800,14,17), 1.0: p(800,21,24), 1.5: p(800,21,24), 2.5: p(800,21,24), 4.0: p(800,21,24), 6.5: p(800,21,24), 10.0: p(800,21,24) }
};

const STANDARDS: Record<SamplingStandard, {
  table: CodeLetterRow[];
  normal: SeverityBlock;
  tightened: SeverityBlock;
  reduced: SeverityBlock;
}> = {
  ANSI_Z1_4: { table: CODE_LETTER_TABLE, normal: SINGLE_NORMAL, tightened: SINGLE_TIGHTENED, reduced: SINGLE_REDUCED },
  ISO_2859_1: { table: CODE_LETTER_TABLE, normal: SINGLE_NORMAL, tightened: SINGLE_TIGHTENED, reduced: SINGLE_REDUCED }
};

export function resolveSamplingPlan(
  plan: SamplingPlanInput,
  lotSize: number,
  standard: SamplingStandard
): SamplingResult {
  const safeLot = Math.max(1, Math.floor(lotSize));

  if (plan.type === "All") {
    return { sampleSize: safeLot, acceptance: 0, rejection: 1, codeLetter: null, standard };
  }
  if (plan.type === "First") {
    const n = Math.min(plan.sampleSize ?? 1, safeLot);
    return { sampleSize: Math.max(1, n), acceptance: 0, rejection: 1, codeLetter: null, standard };
  }
  if (plan.type === "Percentage") {
    const pct = Math.max(0, Math.min(100, plan.percentage ?? 100));
    const n = Math.max(1, Math.min(safeLot, Math.ceil((safeLot * pct) / 100)));
    return { sampleSize: n, acceptance: 0, rejection: 1, codeLetter: null, standard };
  }

  const level = plan.inspectionLevel ?? "II";
  const severity = plan.severity ?? "Normal";
  const aql = plan.aql ?? 1.0;
  const data = STANDARDS[standard];
  const row = data.table.find((r) => safeLot >= r.range.min && safeLot <= r.range.max);
  const letter = row?.levels[level] ?? null;
  if (!letter) {
    return { sampleSize: safeLot, acceptance: 0, rejection: 1, codeLetter: null, standard };
  }
  const block = severity === "Tightened" ? data.tightened : severity === "Reduced" ? data.reduced : data.normal;
  const cell = block[letter]?.[aql];
  if (!cell) {
    return { sampleSize: safeLot, acceptance: 0, rejection: 1, codeLetter: letter, standard };
  }
  if (cell.n >= safeLot) {
    return { sampleSize: safeLot, acceptance: cell.Ac, rejection: cell.Re, codeLetter: letter, standard };
  }
  return { sampleSize: cell.n, acceptance: cell.Ac, rejection: cell.Re, codeLetter: letter, standard };
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
// document's default rule, else 100% inspection. Mirrors samplingStandards.ts
// — keep in sync.
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
