import { resolve } from "node:path";
import { pruneRuns } from "../runs";

// Usage: tsx src/scripts/prune-runs.ts [--cwd <dir>] [--keep-last <n>] [--max-age-days <n>]
//
// GC finished loop runs under llm/loops/runs/. Unfinished runs (no outcome.json)
// are never touched. The OpenClaw janitor calls this each heartbeat to keep the
// box's disk from filling with stale loop artifacts. Prints the result as JSON.
const argv = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const cwd = resolve(opt("--cwd") ?? process.cwd());
const keepLast = opt("--keep-last");
const maxAgeDays = opt("--max-age-days");

const result = pruneRuns(cwd, {
  keepLast: keepLast ? Number(keepLast) : undefined,
  maxAgeDays: maxAgeDays ? Number(maxAgeDays) : undefined
});

console.log(JSON.stringify(result, null, 2));
