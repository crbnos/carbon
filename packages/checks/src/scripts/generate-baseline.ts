import { keyOf, writeBaseline } from "../baseline";
import { collectFindings } from "../run";

const keys = [
  ...new Set(collectFindings().map((f) => keyOf(f.checkId, f.violation)))
];
writeBaseline(keys);
console.log(`Wrote ${keys.length} baselined conformance violations.`);
