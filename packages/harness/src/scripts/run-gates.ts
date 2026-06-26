import { execSync } from "node:child_process";
import { FLOOR_GATES, runGates } from "../gates";

const results = runGates(FLOOR_GATES, (cmd) => {
  try {
    return { ok: true, output: execSync(cmd, { encoding: "utf8" }) };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
});
let failed = 0;
for (const r of results) {
  console.log(`${r.passed ? "PASS" : "FAIL"}  ${r.id}`);
  if (!r.passed) failed++;
}
console.log(
  `\n${results.length - failed}/${results.length} floor gates green.`
);
process.exit(failed > 0 ? 1 : 0);
