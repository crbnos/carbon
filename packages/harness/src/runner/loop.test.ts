import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Binding } from "../binding";
import { readLedger } from "../ledger";
import { runLoop } from "./loop";
import type {
  ClaudeRequest,
  ClaudeResult,
  DoerResult,
  JudgeResult,
  RunnerConfig,
  RunnerDeps
} from "./types";

const BINDING: Binding = {
  id: "bug-1",
  kind: "bug",
  title: "off-by-one in total",
  risk: "low",
  // ≤2 criteria ⇒ the planner session is skipped (single whole-binding task).
  acceptance: ["total is correct", "a test covers it"]
};

function jsonText(obj: unknown): string {
  return `done.\n\`\`\`json\n${JSON.stringify(obj)}\n\`\`\``;
}
const doer = (d: Partial<DoerResult>) =>
  jsonText({
    change: "fix",
    packages: [],
    testCommand: "",
    touchedUI: false,
    ...d
  });
const judge = (j: Partial<JudgeResult>) =>
  jsonText({ approved: false, unmet: [], feedback: "", ...j });

let dir: string;
let ledgerPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "loop-"));
  ledgerPath = join(dir, "ledger.jsonl");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function makeDeps(opts: {
  claude: (req: ClaudeRequest) => ClaudeResult;
  shell?: RunnerDeps["shell"];
  behaviorGate?: RunnerDeps["behaviorGate"];
}): RunnerDeps {
  return {
    claude: opts.claude,
    shell: opts.shell ?? (() => ({ ok: true, output: "" })),
    now: () => "2026-01-01T00:00:00.000Z",
    log: () => undefined,
    ...(opts.behaviorGate ? { behaviorGate: opts.behaviorGate } : {})
  };
}

function makeConfig(over: Partial<RunnerConfig> = {}): RunnerConfig {
  return {
    cwd: dir,
    ledgerPath,
    taskMaxAttempts: 2,
    maxIterations: 8,
    plannerMaxTurns: 5,
    plannerMaxBudgetUsd: 1,
    doerMaxTurns: 10,
    doerMaxBudgetUsd: 1,
    judgeMaxTurns: 5,
    judgeMaxBudgetUsd: 1,
    behaviorMaxTurns: 10,
    behaviorMaxBudgetUsd: 1,
    ...over
  };
}

/** Queue planner/doer/judge responses; route by which prompt the loop sent. */
function scriptedClaude(
  doers: string[],
  judges: string[],
  planners: string[] = []
) {
  const d = [...doers];
  const j = [...judges];
  const p = [...planners];
  return (req: ClaudeRequest): ClaudeResult => {
    const text = req.prompt.includes("You are the DOER")
      ? d.shift()
      : req.prompt.includes("You are the PLANNER")
        ? p.shift()
        : j.shift();
    return { text: text ?? jsonText({}), costUsd: 0, sessionId: "s" };
  };
}

/** Dirty tree by default; named commands can be forced to fail. */
function dirtyShell(fail: string[] = []): RunnerDeps["shell"] {
  return (cmd: string) => {
    if (cmd === "git status --porcelain") return { ok: true, output: " M x" };
    if (fail.some((f) => cmd.includes(f))) return { ok: false, output: "fail" };
    return { ok: true, output: "" };
  };
}

/** dirtyShell that also records commit/push commands. */
function recordingShell(fail: string[] = []): {
  shell: RunnerDeps["shell"];
  commits: string[];
  pushes: string[];
} {
  const commits: string[] = [];
  const pushes: string[] = [];
  const base = dirtyShell(fail);
  const shell: RunnerDeps["shell"] = (cmd, opts) => {
    if (cmd.startsWith("git commit")) commits.push(cmd);
    if (cmd.startsWith("git push")) pushes.push(cmd);
    return base(cmd, opts);
  };
  return { shell, commits, pushes };
}

describe("runLoop", () => {
  it("ships when gates pass and the judge approves — committed AND pushed", () => {
    const { shell, commits, pushes } = recordingShell();
    const deps = makeDeps({
      claude: scriptedClaude(
        [doer({ testCommand: "vitest run" })],
        [judge({ approved: true, unmet: [] })]
      ),
      shell
    });

    const out = runLoop(BINDING, makeConfig(), deps);

    expect(out.state).toBe("shipped");
    expect(out.iterations).toBe(1);
    expect(commits).toHaveLength(1);
    // Commit early, push often — the checkpoint hit origin before gates ran.
    expect(pushes.some((p) => p.includes("--force-with-lease"))).toBe(true);
    expect(
      out.plan?.map((t) => ({ title: t.title, status: t.status }))
    ).toEqual([{ title: BINDING.title, status: "done" }]);
    expect(readLedger(ledgerPath).at(-1)?.decision).toBe("keep");
  });

  it("checkpoints doer slices without a judge session, and slices don't burn attempts", () => {
    let judgeCalls = 0;
    const claude = (req: ClaudeRequest): ClaudeResult => {
      if (req.prompt.includes("You are the DOER")) {
        return { text: "", costUsd: 0, sessionId: "s" };
      }
      judgeCalls++;
      return {
        text: judge({ approved: true, unmet: [] }),
        costUsd: 0,
        sessionId: "s"
      };
    };
    const doers = [
      doer({ change: "models", remaining: "wire the service" }),
      doer({ change: "service", remaining: "wire the UI" }),
      doer({ change: "ui" }) // complete — only now does the judge run
    ];
    const scripted = (req: ClaudeRequest): ClaudeResult =>
      req.prompt.includes("You are the DOER")
        ? { text: doers.shift() ?? "", costUsd: 0, sessionId: "s" }
        : claude(req);
    const deps = makeDeps({
      claude: scripted,
      shell: dirtyShell()
    });

    // 3 slices with taskMaxAttempts=2: slices are progress, not failures.
    const out = runLoop(BINDING, makeConfig({ taskMaxAttempts: 2 }), deps);

    expect(out.state).toBe("shipped");
    expect(out.iterations).toBe(3);
    expect(judgeCalls).toBe(1);
    const ledger = readLedger(ledgerPath);
    expect(ledger.map((e) => e.decision)).toEqual([
      "checkpoint",
      "checkpoint",
      "keep"
    ]);
    expect(ledger[0]?.reason).toBe(
      "slice complete; remaining: wire the service"
    );
  });

  it("counts a no-op 'remaining' session as a failed attempt (no infinite slicing)", () => {
    const cleanShell: RunnerDeps["shell"] = (cmd) => {
      if (cmd === "git status --porcelain") return { ok: true, output: "" };
      return { ok: true, output: "" };
    };
    const deps = makeDeps({
      claude: scriptedClaude(
        [doer({ remaining: "everything" }), doer({ remaining: "everything" })],
        []
      ),
      shell: cleanShell
    });

    const out = runLoop(BINDING, makeConfig({ taskMaxAttempts: 2 }), deps);

    expect(out.state).toBe("plateau");
    expect(
      readLedger(ledgerPath).every((e) =>
        e.reason.includes("no committable slice")
      )
    ).toBe(true);
  });

  it("fixes forward (checkpoint, not revert) when criteria remain, then ships", () => {
    const deps = makeDeps({
      claude: scriptedClaude(
        [doer({}), doer({})],
        [
          judge({ approved: true, unmet: [1] }),
          judge({ approved: true, unmet: [] })
        ]
      ),
      shell: dirtyShell()
    });

    const out = runLoop(BINDING, makeConfig(), deps);

    expect(out.state).toBe("shipped");
    expect(out.iterations).toBe(2);
    const ledger = readLedger(ledgerPath);
    expect(ledger.map((e) => e.decision)).toEqual(["checkpoint", "keep"]);
    expect(ledger[0]?.reason).toContain("criteria still unmet: 1");
  });

  it("checkpoints failed-gate attempts (work preserved) and ends plateau after taskMaxAttempts", () => {
    const deps = makeDeps({
      claude: scriptedClaude([doer({}), doer({})], []), // judge never reached — gates fail
      shell: dirtyShell(["@carbon/checks test"]) // conformance gate fails
    });

    const out = runLoop(BINDING, makeConfig({ taskMaxAttempts: 2 }), deps);

    expect(out.state).toBe("plateau");
    expect(out.reason).toContain("failed after 2 attempts");
    expect(out.plan?.[0]?.status).toBe("failed");
    const ledger = readLedger(ledgerPath);
    // No `git checkout -- .` discards — every attempt is a checkpoint commit.
    expect(ledger.every((e) => e.decision === "checkpoint")).toBe(true);
    expect(ledger.at(-1)?.gates.conformance).toBe(false);
  });

  it("rescues exhausted attempts to a branch and resets to the task start", () => {
    let revParse = 0;
    const base = dirtyShell(["@carbon/checks test"]);
    const calls: string[] = [];
    const shell: RunnerDeps["shell"] = (cmd, opts) => {
      calls.push(cmd);
      if (cmd === "git rev-parse HEAD") {
        revParse++;
        return { ok: true, output: revParse === 1 ? "startsha" : "tipsha" };
      }
      return base(cmd, opts);
    };
    const deps = makeDeps({
      claude: scriptedClaude([doer({}), doer({})], []),
      shell
    });

    const out = runLoop(BINDING, makeConfig({ taskMaxAttempts: 2 }), deps);

    expect(out.state).toBe("plateau");
    expect(
      calls.some((c) =>
        c.includes("git push origin HEAD:refs/heads/loop-rescue/bug-1/t1")
      )
    ).toBe(true);
    expect(calls.some((c) => c === "git reset --hard startsha")).toBe(true);
    const last = readLedger(ledgerPath).at(-1);
    expect(last?.decision).toBe("revert");
    expect(last?.reason).toContain("loop-rescue/bug-1/t1");
  });

  it("continues with a fresh session (never blocks) when the doer returns no verdict", () => {
    const { shell, commits } = recordingShell();
    const deps = makeDeps({
      claude: scriptedClaude(
        ["…capped mid-edit, no json at all…", doer({ change: "finished" })],
        [judge({ approved: true, unmet: [] })]
      ),
      shell
    });

    const out = runLoop(BINDING, makeConfig(), deps);

    expect(out.state).toBe("shipped");
    expect(out.iterations).toBe(2);
    // The capped session's tree was checkpointed, not thrown away or blocked.
    expect(commits).toHaveLength(2);
    const ledger = readLedger(ledgerPath);
    expect(ledger[0]?.decision).toBe("checkpoint");
    expect(ledger[0]?.reason).toContain("without a verdict");
    expect(ledger.at(-1)?.decision).toBe("keep");
  });

  it("ends plateau (work preserved) when the doer never produces a verdict", () => {
    const deps = makeDeps({
      claude: scriptedClaude(["no json", "no json"], []),
      shell: dirtyShell()
    });

    const out = runLoop(BINDING, makeConfig({ taskMaxAttempts: 2 }), deps);

    expect(out.state).toBe("plateau");
    expect(
      readLedger(ledgerPath).every(
        (e) => e.decision === "checkpoint" || e.decision === "revert"
      )
    ).toBe(true);
  });

  it("blocks when the doer reports it cannot proceed — after checkpointing its work", () => {
    const { shell, commits } = recordingShell();
    const deps = makeDeps({
      claude: scriptedClaude(
        [doer({ blocked: "need a product decision" })],
        []
      ),
      shell
    });

    const out = runLoop(BINDING, makeConfig(), deps);

    expect(out.state).toBe("blocked");
    expect(out.reason).toContain("need a product decision");
    // The dirty tree was committed before blocking — nothing thrown away.
    expect(commits).toHaveLength(1);
    expect(readLedger(ledgerPath).at(-1)?.decision).toBe("checkpoint");
  });

  it("blocks a UI change when no behavior gate is wired (milestone 1)", () => {
    const deps = makeDeps({
      claude: scriptedClaude([doer({ touchedUI: true })], []),
      shell: dirtyShell()
    });

    const out = runLoop(BINDING, makeConfig(), deps);

    expect(out.state).toBe("blocked");
    expect(out.reason).toContain("behavior gate");
  });

  it("ships flagged (not reverted) when the behavior gate cannot verify either way", () => {
    const { shell, commits } = recordingShell();
    const deps = makeDeps({
      claude: scriptedClaude(
        [doer({ touchedUI: true })],
        [judge({ approved: true, unmet: [] })]
      ),
      shell,
      behaviorGate: () => ({
        passed: false,
        screenshots: [],
        notes: "could not construct a PO with two receipts",
        unverified: "could not construct a PO with two receipts"
      })
    });

    const out = runLoop(BINDING, makeConfig(), deps);

    expect(out.state).toBe("shipped");
    expect(out.unverified).toEqual([
      "could not construct a PO with two receipts"
    ]);
    expect(out.reason).toContain("needs human verification");
    expect(commits).toHaveLength(1);
    const last = readLedger(ledgerPath).at(-1);
    expect(last?.decision).toBe("keep");
    // The behavior gate must not be recorded as failed — proof was unavailable.
    expect(last?.gates.behavior).toBeUndefined();
  });

  it("checkpoints (never discards) when the behavior gate DISPROVES the change", () => {
    const deps = makeDeps({
      claude: scriptedClaude(
        [doer({ touchedUI: true }), doer({ touchedUI: true })],
        []
      ),
      shell: dirtyShell(),
      behaviorGate: () => ({
        passed: false,
        screenshots: ["bug.png"],
        notes: "reproduced the state; still broken"
      })
    });

    const out = runLoop(BINDING, makeConfig({ taskMaxAttempts: 2 }), deps);

    expect(out.state).toBe("plateau");
    const ledger = readLedger(ledgerPath);
    expect(ledger.every((e) => e.decision === "checkpoint")).toBe(true);
    expect(ledger.at(-1)?.gates.behavior).toBe(false);
  });

  it("retries the judge once when it returns no verdict, then ships on the retry", () => {
    const deps = makeDeps({
      claude: scriptedClaude(
        [doer({})],
        [
          "…budget ran out mid-review, no json…",
          judge({ approved: true, unmet: [] })
        ]
      ),
      shell: dirtyShell()
    });

    const out = runLoop(BINDING, makeConfig(), deps);

    expect(out.state).toBe("shipped");
    expect(out.iterations).toBe(1);
    expect(readLedger(ledgerPath).at(-1)?.decision).toBe("keep");
  });

  it("concludes a task FLAGGED (kept, never reverted) when the judge has no verdict after retry", () => {
    const { shell, commits } = recordingShell();
    const noVerdict = "…no json at all…";
    const deps = makeDeps({
      claude: scriptedClaude([doer({})], [noVerdict, noVerdict]),
      shell
    });

    const out = runLoop(BINDING, makeConfig(), deps);

    expect(out.state).toBe("shipped");
    expect(
      out.plan?.map((t) => ({ title: t.title, status: t.status }))
    ).toEqual([{ title: BINDING.title, status: "flagged" }]);
    expect(out.unverified?.[0]).toContain("WITHOUT judge review");
    expect(commits).toHaveLength(1);
    expect(readLedger(ledgerPath).at(-1)?.decision).toBe("keep");
    expect(readLedger(ledgerPath).at(-1)?.reason).toContain(
      "pending human review"
    );
  });

  it("ships with open questions when the judge disputes a criterion instead of churning", () => {
    const deps = makeDeps({
      claude: scriptedClaude(
        [doer({ assumptions: ["kept 'Set Quantity' as the default"] })],
        [
          judge({
            approved: true,
            unmet: [],
            disputed: [{ index: 1, question: "is this criterion intentional?" }]
          })
        ]
      ),
      shell: dirtyShell()
    });

    const out = runLoop(BINDING, makeConfig(), deps);

    expect(out.state).toBe("shipped");
    expect(out.questions).toEqual([
      'Acceptance [1] "a test covers it": is this criterion intentional?',
      "Assumption: kept 'Set Quantity' as the default"
    ]);
  });

  it("resumes a prior non-shipped run: concluded tasks are skipped, flags carried over", () => {
    // A prior run (e.g. before a crash / doer cap) left its plan in
    // outcome.json — committed with the branch. Task 1 is already done.
    mkdirSync(join(dir, ".ai", "runs", "bug-1"), { recursive: true });
    writeFileSync(
      join(dir, ".ai", "runs", "bug-1", "outcome.json"),
      JSON.stringify({
        state: "blocked",
        iterations: 3,
        reason: "doer capped",
        unverified: ["carried: needs human verification of X"],
        plan: [
          { title: "models", detail: "d", criteria: [0], status: "done" },
          { title: "wiring", detail: "d", criteria: [1], status: "pending" }
        ]
      })
    );
    let doerSessions = 0;
    const claude = (req: ClaudeRequest): ClaudeResult => {
      if (req.prompt.includes("You are the DOER")) {
        doerSessions++;
        return { text: doer({ change: "wiring" }), costUsd: 0, sessionId: "s" };
      }
      return {
        text: judge({ approved: true, unmet: [] }),
        costUsd: 0,
        sessionId: "s"
      };
    };
    const deps = makeDeps({ claude, shell: dirtyShell() });

    const out = runLoop(BINDING, makeConfig(), deps);

    expect(out.state).toBe("shipped");
    // Only the pending task spent a session — the done one was skipped free.
    expect(doerSessions).toBe(1);
    expect(out.plan?.map((t) => t.status)).toEqual(["done", "done"]);
    // The prior run's flags survive the re-dispatch.
    expect(out.unverified).toContain("carried: needs human verification of X");
  });

  describe("with a planner-decomposed binding", () => {
    const BIG: Binding = {
      id: "feat-1",
      kind: "feature",
      title: "period close",
      risk: "med",
      acceptance: ["migration exists", "service posts", "UI shows status"]
    };
    const plan = jsonText({
      tasks: [
        { title: "migration", detail: "…", criteria: [0] },
        { title: "service + UI", detail: "…", criteria: [1, 2] }
      ]
    });

    it("drives tasks in order, one judge per task, and ships", () => {
      const deps = makeDeps({
        claude: scriptedClaude(
          [doer({ change: "migration" }), doer({ change: "service+ui" })],
          [
            judge({ approved: true, unmet: [1, 2] }), // task 1: its criterion [0] met
            judge({ approved: true, unmet: [] })
          ],
          [plan]
        ),
        shell: dirtyShell()
      });

      const out = runLoop(BIG, makeConfig(), deps);

      expect(out.state).toBe("shipped");
      expect(
        out.plan?.map((t) => ({ title: t.title, status: t.status }))
      ).toEqual([
        { title: "migration", status: "done" },
        { title: "service + UI", status: "done" }
      ]);
      const ledger = readLedger(ledgerPath);
      expect(ledger.map((e) => e.decision)).toEqual(["keep", "keep"]);
      expect(ledger[0]?.task).toBe("1/2: migration");
    });

    it("blocks after 2 consecutive judge-less tasks, keeping both", () => {
      const noVerdict = "…no json…";
      const deps = makeDeps({
        claude: scriptedClaude(
          [doer({}), doer({})],
          // 2 tasks × (ask + retry), all verdict-less
          [noVerdict, noVerdict, noVerdict, noVerdict],
          [plan]
        ),
        shell: dirtyShell()
      });

      const out = runLoop(BIG, makeConfig(), deps);

      expect(out.state).toBe("blocked");
      expect(out.reason).toContain("judge produced no verdict");
      expect(out.plan?.map((t) => t.status)).toEqual(["flagged", "flagged"]);
      expect(readLedger(ledgerPath).every((e) => e.decision === "keep")).toBe(
        true
      );
    });
  });
});
