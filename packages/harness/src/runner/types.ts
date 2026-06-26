import type { Binding } from "../binding";
import type { Gate } from "../gates";

/** How a run ends. `shipped` = green committed state ready for a PR. */
export type TerminalState = "shipped" | "blocked" | "plateau" | "error";

export type LoopOutcome = {
  state: TerminalState;
  iterations: number;
  /** Set when `state === "shipped"` and the script opened a PR. */
  prUrl?: string;
  reason: string;
};

/**
 * What the doer subagent reports after one change attempt. The doer is agentic
 * (it edits files in the worktree); this is its structured handoff to the loop.
 */
export type DoerResult = {
  /** One-line summary of the change made (goes in the ledger). */
  change: string;
  /** Packages touched, for per-package typecheck — e.g. ["@carbon/checks"]. */
  packages: string[];
  /** A command that FAILS before the fix and PASSES after (the correctness gate). "" if N/A. */
  testCommand: string;
  /** True if the change touches UI / user-facing surface (needs the behavior gate). */
  touchedUI: boolean;
  /** Set when the doer cannot proceed without a human — surfaces as a BLOCKED outcome. */
  blocked?: string;
};

/** The judge subagent's verdict on the current (uncommitted) iteration. */
export type JudgeResult = {
  approved: boolean;
  /** Indices into `binding.acceptance` of criteria still unmet. Empty ⇒ done. */
  unmet: number[];
  feedback: string;
};

/** Outcome of the UI behavior gate (boot stack + agent-browser). */
export type BehaviorResult = {
  passed: boolean;
  screenshots: string[];
  notes: string;
  /**
   * Set when the gate cannot even attempt verification — the stack isn't up and
   * a bounded boot failed. This is environmental: ends the loop as BLOCKED (the
   * skill's "stack can't boot → stop and surface"), never a silent revert/retry.
   */
  blocked?: string;
};

export type ClaudeRequest = {
  prompt: string;
  cwd: string;
  maxTurns: number;
  maxBudgetUsd: number;
};

export type ClaudeResult = {
  /** The model's final text (we parse a trailing ```json block out of it). */
  text: string;
  costUsd: number;
  sessionId: string;
  /** True when claude stopped on an error/limit (`is_error`) — the text may be partial. */
  incomplete?: boolean;
  /** claude's stop subtype, e.g. "error_max_turns" / "error_max_budget". */
  stopReason?: string;
};

/** A command runner bound to a working directory. Mirrors `Exec` but cwd-aware. */
export type Shell = (
  cmd: string,
  opts?: { cwd?: string }
) => { ok: boolean; output: string };

/**
 * Everything the pure loop needs from the outside world. Inject fakes in tests;
 * the script wires real `claude -p` / `git` / `crbn` adapters.
 */
export type RunnerDeps = {
  claude: (req: ClaudeRequest) => ClaudeResult;
  shell: Shell;
  /** ISO timestamp — the harness has no clock, the caller supplies one. */
  now: () => string;
  log: (event: Record<string, unknown>) => void;
  /**
   * The UI behavior gate. Absent in milestone 1 — when a change `touchedUI` and
   * this is undefined, the loop BLOCKS (honest: a UI change unverified is not done).
   */
  behaviorGate?: (
    binding: Binding,
    cfg: RunnerConfig,
    deps: RunnerDeps
  ) => BehaviorResult;
};

export type RunnerConfig = {
  /** Absolute path to the worktree the loop runs in. */
  cwd: string;
  /** Where to append the ledger (e.g. llm/loops/<id>/ledger.jsonl). */
  ledgerPath: string;
  /** Stop after this many consecutive iterations with no kept change. */
  plateauAfter: number;
  /** Hard ceiling on total iterations. */
  maxIterations: number;
  /** The floor gates to run each dirty iteration. Defaults to Carbon's FLOOR_GATES. */
  gates?: Gate[];
  doerMaxTurns: number;
  doerMaxBudgetUsd: number;
  judgeMaxTurns: number;
  judgeMaxBudgetUsd: number;
  behaviorMaxTurns: number;
  behaviorMaxBudgetUsd: number;
};

export const DEFAULT_CONFIG: Omit<RunnerConfig, "cwd" | "ledgerPath"> = {
  plateauAfter: 2,
  maxIterations: 8,
  doerMaxTurns: 60,
  doerMaxBudgetUsd: 5,
  judgeMaxTurns: 20,
  judgeMaxBudgetUsd: 2,
  behaviorMaxTurns: 40,
  behaviorMaxBudgetUsd: 3
};
