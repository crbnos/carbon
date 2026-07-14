import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { resolve } from "node:path";
import { parseBinding } from "../binding";
import * as layout from "../layout";
import { readLedger } from "../ledger";
import { behaviorGate } from "../runner/behavior";
import { claude } from "../runner/claude";
import { runLoop } from "../runner/loop";
import { openPr } from "../runner/pr";
import { shell } from "../runner/shell";
import { DEFAULT_CONFIG, type RunnerConfig } from "../runner/types";

// Usage: tsx src/scripts/run-loop.ts <binding.loop.md> [--cwd <worktree>] [--no-pr]
//        [--doer-budget <usd>] [--judge-budget <usd>] [--judge-turns <n>]
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

// Optional budget/turn overrides for per-dispatch tuning (#1063) — e.g.
// --doer-budget 10 for complex features, --judge-budget 5 for many criteria.
const numFlag = (name: string): number => {
  const idx = argv.indexOf(name);
  return idx >= 0 ? Number.parseFloat(argv[idx + 1] ?? "") : Number.NaN;
};
const doerBudgetOverride = numFlag("--doer-budget");
const judgeBudgetOverride = numFlag("--judge-budget");
const judgeTurnsOverride = numFlag("--judge-turns");

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

const config: RunnerConfig = {
  ...DEFAULT_CONFIG,
  cwd,
  ledgerPath,
  ...(Number.isFinite(doerBudgetOverride)
    ? { doerMaxBudgetUsd: doerBudgetOverride }
    : {}),
  ...(Number.isFinite(judgeBudgetOverride)
    ? { judgeMaxBudgetUsd: judgeBudgetOverride }
    : {}),
  ...(Number.isFinite(judgeTurnsOverride)
    ? { judgeMaxTurns: Math.trunc(judgeTurnsOverride) }
    : {})
};

const outcome = runLoop(binding, config, {
  claude,
  shell,
  now: () => new Date().toISOString(),
  log,
  behaviorGate
});

// Open a PR whenever there is committed work — shipped runs always, and
// non-shipped runs (plateau/blocked/error) as a SALVAGE draft. Checkpoint and
// kept commits are already on the branch (and pushed); discarding them with
// the worktree wastes the spend. Unproven work goes up flagged, never
// silently dropped. Salvage failures (e.g. branch equals base after a full
// rescue-reset) are logged, never fatal — the outcome still gets written.
const committedWork = readLedger(ledgerPath).some(
  (e) => e.decision === "keep" || e.decision === "checkpoint"
);
if (!noPr && (outcome.state === "shipped" || committedWork)) {
  try {
    const url = openPr(binding, ledgerPath, shell, cwd, {
      ...(outcome.unverified ? { unverified: outcome.unverified } : {}),
      ...(outcome.questions ? { questions: outcome.questions } : {}),
      ...(outcome.plan ? { plan: outcome.plan } : {}),
      ...(outcome.state !== "shipped"
        ? { partial: { state: outcome.state, reason: outcome.reason } }
        : {})
    });
    outcome.prUrl = url;
    log({ event: "pr", url, partial: outcome.state !== "shipped" });
    console.log(`\nPR: ${url}`);
  } catch (err) {
    log({
      event: "pr:failed",
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

log({ event: "outcome", ...outcome });
// Structured result an external orchestrator reads instead of scraping stdout.
writeFileSync(
  layout.outcomePath(cwd, binding.id),
  `${JSON.stringify(outcome, null, 2)}\n`
);

process.exit(outcome.state === "shipped" ? 0 : 1);
