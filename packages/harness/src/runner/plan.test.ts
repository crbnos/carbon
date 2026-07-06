import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Binding } from "../binding";
import { buildPlan, parsePlanResult, resolvePlan } from "./plan";
import type { ClaudeResult, RunnerConfig, RunnerDeps } from "./types";

const BINDING: Binding = {
  id: "feat-1",
  kind: "feature",
  title: "period close",
  risk: "med",
  acceptance: ["migration", "service", "UI", "docs"]
};

const SMALL: Binding = { ...BINDING, acceptance: ["one", "two"] };

function json(obj: unknown): string {
  return `\`\`\`json\n${JSON.stringify(obj)}\n\`\`\``;
}

function deps(claude: () => ClaudeResult): RunnerDeps {
  return {
    claude,
    shell: () => ({ ok: true, output: "" }),
    now: () => "t",
    log: () => undefined
  };
}

const config = {
  cwd: "/tmp",
  ledgerPath: "/tmp/l.jsonl",
  taskMaxAttempts: 3,
  maxIterations: 16,
  plannerMaxTurns: 5,
  plannerMaxBudgetUsd: 1,
  doerMaxTurns: 1,
  doerMaxBudgetUsd: 1,
  judgeMaxTurns: 1,
  judgeMaxBudgetUsd: 1,
  behaviorMaxTurns: 1,
  behaviorMaxBudgetUsd: 1
} satisfies RunnerConfig;

describe("parsePlanResult", () => {
  it("parses tasks and appends a catch-all for uncovered criteria", () => {
    const tasks = parsePlanResult(
      json({
        tasks: [
          { title: "migration", detail: "d", criteria: [0] },
          { title: "service", detail: "d", criteria: [1, 2] }
        ]
      }),
      BINDING
    );
    expect(tasks.map((t) => t.title)).toEqual([
      "migration",
      "service",
      "Remaining acceptance criteria"
    ]);
    expect(tasks.at(-1)?.criteria).toEqual([3]);
  });

  it("drops out-of-range criteria and junk entries", () => {
    const tasks = parsePlanResult(
      json({
        tasks: [
          { title: "ok", detail: "d", criteria: [0, 99, -1, 1, 2, 3] },
          { detail: "no title" },
          "garbage"
        ]
      }),
      BINDING
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.criteria).toEqual([0, 1, 2, 3]);
  });

  it("degrades to one whole-binding task when the planner output is unusable", () => {
    for (const text of ["no json here", json({ tasks: [] }), json({})]) {
      const tasks = parsePlanResult(text, BINDING);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]?.criteria).toEqual([0, 1, 2, 3]);
    }
  });
});

describe("resolvePlan", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function cwdWithOutcome(outcome: unknown): string {
    const cwd = mkdtempSync(join(tmpdir(), "plan-resume-"));
    dirs.push(cwd);
    if (outcome !== undefined) {
      mkdirSync(join(cwd, ".ai", "runs", BINDING.id), { recursive: true });
      writeFileSync(
        join(cwd, ".ai", "runs", BINDING.id, "outcome.json"),
        JSON.stringify(outcome)
      );
    }
    return cwd;
  }

  it("resumes a non-shipped prior run: statuses and flags carried, no planner session", () => {
    const cwd = cwdWithOutcome({
      state: "blocked",
      unverified: ["needs human check"],
      questions: ["is X intentional?"],
      plan: [
        { title: "a", detail: "d", criteria: [0, 1], status: "done" },
        { title: "b", detail: "d", criteria: [2], status: "flagged" },
        { title: "c", detail: "d", criteria: [3], status: "failed" }
      ]
    });
    let planner = 0;
    const r = resolvePlan(
      BINDING,
      { ...config, cwd },
      deps(() => {
        planner++;
        return { text: "", costUsd: 0, sessionId: "s" };
      })
    );
    expect(planner).toBe(0);
    expect(r.resumed).toBe(true);
    expect(r.tasks.map((t) => t.title)).toEqual(["a", "b", "c"]);
    // done/flagged stay concluded; failed re-runs as pending
    expect(r.status).toEqual(["done", "flagged", "pending"]);
    expect(r.unverified).toEqual(["needs human check"]);
    expect(r.questions).toEqual(["is X intentional?"]);
  });

  it("never resumes a shipped outcome (PR-feedback re-entry gets a fresh plan)", () => {
    const cwd = cwdWithOutcome({
      state: "shipped",
      plan: [{ title: "a", detail: "d", criteria: [0], status: "done" }]
    });
    const r = resolvePlan(
      BINDING,
      { ...config, cwd },
      deps(() => {
        throw new Error("planner dead"); // falls back to whole-binding task
      })
    );
    expect(r.resumed).toBe(false);
    expect(r.status).toEqual(["pending"]);
  });

  it("falls through to fresh planning when no outcome exists", () => {
    const cwd = cwdWithOutcome(undefined);
    const r = resolvePlan(
      BINDING,
      { ...config, cwd },
      deps(() => {
        throw new Error("planner dead");
      })
    );
    expect(r.resumed).toBe(false);
    expect(r.tasks).toHaveLength(1);
  });
});

describe("buildPlan", () => {
  it("skips the planner session entirely for loop-sized bindings (≤2 criteria)", () => {
    let called = 0;
    const tasks = buildPlan(
      SMALL,
      config,
      deps(() => {
        called++;
        return { text: "", costUsd: 0, sessionId: "s" };
      })
    );
    expect(called).toBe(0);
    expect(tasks).toHaveLength(1);
  });

  it("never lets a planner crash kill the run — falls back to one task", () => {
    const tasks = buildPlan(
      BINDING,
      config,
      deps(() => {
        throw new Error("claude failed to spawn");
      })
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.criteria).toEqual([0, 1, 2, 3]);
  });
});
