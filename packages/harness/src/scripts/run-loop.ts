import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { resolve } from "node:path";
import { parseBinding } from "../binding";
import * as layout from "../layout";
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

const bindingMd = readFileSync(resolve(bindingPath), "utf8");
const binding = parseBinding(bindingMd);

// All artifacts live under one gitignored, harness-owned run dir (see layout.ts).
mkdirSync(layout.runDir(cwd, binding.id), { recursive: true });
// Persist the binding so the run is self-describing (inspection / re-entry).
writeFileSync(layout.bindingPath(cwd, binding.id), bindingMd);

const ledgerPath = layout.ledgerPath(cwd, binding.id);
const logPath = layout.logPath(cwd, binding.id);

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

if (outcome.state === "shipped" && !noPr) {
  const url = openPr(binding, ledgerPath, shell, cwd);
  outcome.prUrl = url;
  log({ event: "pr", url });
  console.log(`\nPR: ${url}`);
}

log({ event: "outcome", ...outcome });
// Structured result an external orchestrator reads instead of scraping stdout.
writeFileSync(
  layout.outcomePath(cwd, binding.id),
  `${JSON.stringify(outcome, null, 2)}\n`
);

process.exit(outcome.state === "shipped" ? 0 : 1);
