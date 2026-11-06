// Constructor-level diff of two DUMP files from heap-retainers.mjs.
//   node heap-diff.mjs a.json b.json [top]
import { readFileSync } from "node:fs";
const [a, b, top = "30"] = process.argv.slice(2);
const before = new Map(JSON.parse(readFileSync(a, "utf8")));
const after = new Map(JSON.parse(readFileSync(b, "utf8")));
const rows = [...after].map(([k, [size, count]]) => {
  const [s0, c0] = before.get(k) ?? [0, 0];
  return [k, size - s0, count - c0];
});
console.log("    +MB    +count  constructor");
for (const [k, ds, dc] of rows.sort((x, y) => y[1] - x[1]).slice(0, Number(top)))
  console.log(`${(ds / 1048576).toFixed(1).padStart(7)} ${String(dc).padStart(9)}  ${k}`);
