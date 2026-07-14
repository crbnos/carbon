import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Binding } from "../binding";
import { openPr } from "./pr";
import type { Shell } from "./types";

const BINDING: Binding = {
  id: "bug-x",
  kind: "bug",
  title: "Fix the thing",
  risk: "low",
  acceptance: ["it works"]
};

/** A fake Shell that returns a canned response per substring match, recording calls. */
function fakeShell(
  responses: Array<[string, { ok: boolean; output: string }]>
): { shell: Shell; calls: string[] } {
  const calls: string[] = [];
  const shell: Shell = (cmd) => {
    calls.push(cmd);
    for (const [needle, res] of responses) if (cmd.includes(needle)) return res;
    return { ok: true, output: "" };
  };
  return { shell, calls };
}

function ledgerWithOneEntry(): string {
  const dir = mkdtempSync(join(tmpdir(), "pr-led-"));
  const path = join(dir, "ledger.jsonl");
  writeFileSync(
    path,
    `${JSON.stringify({ iteration: 1, change: "x", gates: {}, decision: "keep", reason: "r", at: "t" })}\n`
  );
  return path;
}

describe("openPr idempotency", () => {
  it("creates a PR when none exists, returns its URL", () => {
    const url = "https://github.com/o/r/pull/1";
    const { shell, calls } = fakeShell([
      ["git push", { ok: true, output: "" }],
      ["gh pr view", { ok: false, output: "no pull requests found" }],
      ["gh pr create", { ok: true, output: `${url}\n` }]
    ]);
    const cwd = mkdtempSync(join(tmpdir(), "pr-cwd-"));

    expect(openPr(BINDING, ledgerWithOneEntry(), shell, cwd)).toBe(url);
    expect(calls.some((c) => c.includes("gh pr create"))).toBe(true);
    expect(calls.some((c) => c.includes("gh pr edit"))).toBe(false);
  });

  it("updates the existing PR on re-entry instead of erroring", () => {
    const url = "https://github.com/o/r/pull/7";
    const { shell, calls } = fakeShell([
      ["git push", { ok: true, output: "" }],
      ["gh pr view", { ok: true, output: `${url}\n` }],
      ["gh pr edit", { ok: true, output: "" }]
    ]);
    const cwd = mkdtempSync(join(tmpdir(), "pr-cwd-"));

    expect(openPr(BINDING, ledgerWithOneEntry(), shell, cwd)).toBe(url);
    expect(calls.some((c) => c.includes("gh pr edit"))).toBe(true);
    expect(calls.some((c) => c.includes("gh pr create"))).toBe(false);
  });

  it("opens a fully-verified PR as non-draft with no label", () => {
    const { shell, calls } = fakeShell([
      ["gh pr view", { ok: false, output: "" }],
      ["gh pr create", { ok: true, output: "https://github.com/o/r/pull/2\n" }]
    ]);
    const cwd = mkdtempSync(join(tmpdir(), "pr-cwd-"));

    openPr(BINDING, ledgerWithOneEntry(), shell, cwd);
    const create = calls.find((c) => c.includes("gh pr create"));
    expect(create).not.toContain("--draft");
    expect(calls.some((c) => c.includes("--add-label"))).toBe(false);
  });

  it("opens unverified work as a draft with the needs-verification label", () => {
    const { shell, calls } = fakeShell([
      ["gh pr view", { ok: false, output: "" }],
      ["gh pr create", { ok: true, output: "https://github.com/o/r/pull/3\n" }]
    ]);
    const cwd = mkdtempSync(join(tmpdir(), "pr-cwd-"));

    openPr(BINDING, ledgerWithOneEntry(), shell, cwd, {
      unverified: ["could not create test data for a posted invoice"]
    });
    const create = calls.find((c) => c.includes("gh pr create"));
    expect(create).toContain("--draft");
    expect(
      calls.some((c) => c.includes("--add-label 'agent:needs-verification'"))
    ).toBe(true);
  });

  it("opens a partial salvage PR as a draft that does not auto-close the issue", () => {
    const { shell, calls } = fakeShell([
      ["gh pr view", { ok: false, output: "" }],
      ["gh pr create", { ok: true, output: "https://github.com/o/r/pull/4\n" }]
    ]);
    const cwd = mkdtempSync(join(tmpdir(), "pr-cwd-"));

    openPr({ ...BINDING, issue: 310 }, ledgerWithOneEntry(), shell, cwd, {
      partial: { state: "plateau", reason: "no progress across 2 iterations" }
    });
    const create = calls.find((c) => c.includes("gh pr create"));
    expect(create).toContain("--draft");
    expect(create).toContain("[partial]");
    expect(
      calls.some((c) => c.includes("--add-label 'agent:needs-verification'"))
    ).toBe(true);
    // Merging partial work must not close the issue.
    const bodyPath = create?.match(/--body-file '([^']+)'/)?.[1];
    expect(bodyPath).toBeDefined();
    const body = readFileSync(bodyPath ?? "", "utf8");
    expect(body).toContain("Related to #310");
    expect(body).not.toContain("Closes #310");
    expect(body).toContain("Partial work");
  });
});
