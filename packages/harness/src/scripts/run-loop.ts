import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseBinding } from "../binding";
import { behaviorGate } from "../runner/behavior";
import { claude } from "../runner/claude";
import { runLoop } from "../runner/loop";
import { openPr } from "../runner/pr";
import { shell } from "../runner/shell";
import { DEFAULT_CONFIG, type RunnerConfig } from "../runner/types";

// Usage: tsx src/scripts/run-loop.ts <binding.loop.md> [--cwd <worktree>] [--no-pr]
//
// Milestone 1: run inside a worktree you already created (`crbn new` + `crbn up`)
// and pass it via --cwd. Drives one binding to a gated PR, fully unattended.
const argv = process.argv.slice(2);
const bindingPath = argv.find((a) => !a.startsWith("--"));
if (!bindingPath) {
  console.error(
    "usage: run-loop <binding.loop.md> [--cwd <worktree>] [--no-pr]"
  );
  process.exit(2);
}

const cwdIdx = argv.indexOf("--cwd");
const cwdArg = cwdIdx >= 0 ? argv[cwdIdx + 1] : undefined;
const cwd = resolve(
  cwdArg && !cwdArg.startsWith("--") ? cwdArg : process.cwd()
);
const noPr = argv.includes("--no-pr");

const binding = parseBinding(readFileSync(resolve(bindingPath), "utf8"));
const ledgerPath = resolve(cwd, `llm/loops/${binding.id}/ledger.jsonl`);
const logPath = resolve(cwd, `llm/loops/${binding.id}/run.log.jsonl`);
mkdirSync(dirname(logPath), { recursive: true });

const log = (event: Record<string, unknown>) => {
  const line = JSON.stringify({ at: new Date().toISOString(), ...event });
  console.log(line);
  try {
    appendFileSync(logPath, `${line}\n`);
  } catch {
    /* logging is best-effort */
  }
};

const config: RunnerConfig = { ...DEFAULT_CONFIG, cwd, ledgerPath };

const outcome = runLoop(binding, config, {
  claude,
  shell,
  now: () => new Date().toISOString(),
  log,
  behaviorGate
});
log({ event: "outcome", ...outcome });

if (outcome.state === "shipped" && !noPr) {
  const url = openPr(binding, ledgerPath, shell, cwd);
  log({ event: "pr", url });
  console.log(`\nPR: ${url}`);
}

process.exit(outcome.state === "shipped" ? 0 : 1);
