import { mkdtempSync, writeFileSync } from "node:fs";
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
});
