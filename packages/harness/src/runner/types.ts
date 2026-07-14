import type { Binding } from "../binding";
import type { Gate } from "../gates";

/** How a run ends. `shipped` = green committed state ready for a PR. */
export type TerminalState = "shipped" | "blocked" | "plateau" | "error";

/**
 * One unit of the harness-owned plan: small enough for one doer session to
 * complete and one judge session to review, independently committable, and
 * mapped to the acceptance criteria it advances.
 */
export type PlanTask = {
  title: string;
  detail: string;
  /** Indices into `binding.acceptance` this task advances. */
  criteria: number[];
};

/** Where a plan task ended up. `flagged` = kept without judge review. */
export type TaskStatus = "done" | "flagged" | "failed" | "pending";

export type LoopOutcome = {
  state: TerminalState;
  iterations: number;
  /** Set when the script opened a PR (shipped, or a partial salvage PR). */
  prUrl?: string;
  reason: string;
  /**
   * Proof gaps on KEPT work — the behavior gate could not verify either way
   * (missing test data, unreachable state, capped session, stack down). The
   * work still ships, as a draft PR flagged for human verification; "we
   * couldn't prove it" is not "it doesn't work".
   */
  unverified?: string[];
  /**
   * Product questions raised during the loop (disputed acceptance criteria,
   * doer assumptions). The outer loop posts these back to the issue so future
   * grooming resolves them BEFORE the next dispatch.
   */
  questions?: string[];
  /**
   * The task plan and where each task ended up. Carries the full task
   * definitions (detail + criteria) so a re-dispatch on the same branch can
   * RESUME: concluded tasks are skipped, pending/failed ones re-run.
   * The PR renders this as a checklist.
   */
  plan?: {
    title: string;
    detail: string;
    criteria: number[];
    status: TaskStatus;
  }[];
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
  /**
   * Set when the doer chunked its own work: this session finished a coherent,
   * committable SLICE of the task and this is what's left. The loop
   * checkpoints the slice, skips the judge (nothing to approve yet), doesn't
   * count it as a failed attempt, and gives the next session this context.
   */
  remaining?: string;
  /**
   * Interpretation calls the doer made instead of asking a human (ambiguous
   * criterion, unstated default…). Kept assumptions surface on the PR as open
   * questions — the loop never stops to ask.
   */
  assumptions?: string[];
  /**
   * Set when the doer produced NO parseable verdict (capped session, garbled
   * output). Absence of a verdict is not a blocker: the tree is checkpointed
   * as-is, the iteration counts as a failed attempt, and a FRESH session
   * continues the task — the run never dies over one capped session
   * (#1031's T4 ended a whole run this way).
   */
  noVerdict?: true;
  /** Set when the doer cannot proceed without a human — surfaces as a BLOCKED
   *  outcome. Reserved for hard impossibilities, never questions of preference. */
  blocked?: string;
};

/** The judge subagent's verdict on the current (uncommitted) iteration. */
export type JudgeResult = {
  approved: boolean;
  /** Indices into `binding.acceptance` of criteria still unmet. Empty ⇒ done. */
  unmet: number[];
  /**
   * Criteria the judge believes rest on a wrong premise or need a product
   * decision — a question for the human, NOT an unmet criterion. Disputed
   * indices are excluded from `unmet` so the loop doesn't churn on them; the
   * questions ride the PR/issue instead.
   */
  disputed?: { index: number; question: string }[];
  /**
   * Set when the judge produced NO parseable verdict (capped session, garbled
   * output). Absence of a verdict is not a rejection: the loop retries once,
   * and if still missing, KEEPS gate-green work flagged for human review
   * instead of silently reverting it — a missing verdict must never discard
   * real doer work (issue #1031 lost ~$8.5 of correct migration work to this).
   */
  verdictMissing?: true;
  feedback: string;
};

/** Outcome of the UI behavior gate (boot stack + agent-browser). */
export type BehaviorResult = {
  /** True only when the gate SAW the acceptance behavior work in the app. */
  passed: boolean;
  screenshots: string[];
  notes: string;
  /**
   * Set when the gate could not obtain proof EITHER WAY — missing test data it
   * couldn't construct, unreachable state, a capped session, or a stack that
   * won't boot. This is NOT a failure: `passed: false` with `unverified` unset
   * means the gate reached the state and saw the fix NOT work (revert); with
   * `unverified` set, the loop keeps judge-approved work and ships it as a
   * draft PR flagged for human verification instead of discarding it.
   */
  unverified?: string;
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
  /** Where to append the ledger (e.g. .ai/runs/<id>/ledger.jsonl). */
  ledgerPath: string;
  /** Doer attempts per plan task before the task is failed (attempts are
   *  preserved on a rescue branch, never discarded). */
  taskMaxAttempts: number;
  /** Hard ceiling on total iterations across all tasks. */
  maxIterations: number;
  /** The floor gates to run each dirty iteration. Defaults to Carbon's FLOOR_GATES. */
  gates?: Gate[];
  plannerMaxTurns: number;
  plannerMaxBudgetUsd: number;
  doerMaxTurns: number;
  doerMaxBudgetUsd: number;
  judgeMaxTurns: number;
  judgeMaxBudgetUsd: number;
  behaviorMaxTurns: number;
  behaviorMaxBudgetUsd: number;
};

export const DEFAULT_CONFIG: Omit<RunnerConfig, "cwd" | "ledgerPath"> = {
  taskMaxAttempts: 3,
  maxIterations: 16,
  plannerMaxTurns: 25,
  plannerMaxBudgetUsd: 2,
  doerMaxTurns: 60,
  doerMaxBudgetUsd: 5,
  judgeMaxTurns: 30,
  judgeMaxBudgetUsd: 5,
  behaviorMaxTurns: 300,
  behaviorMaxBudgetUsd: 15
};
