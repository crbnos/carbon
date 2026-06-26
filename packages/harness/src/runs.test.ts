import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  utimesSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bindingPath, outcomePath, runDir } from "./layout";
import { listRuns, pruneRuns, readOutcome } from "./runs";

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function tmpCwd(): string {
  return mkdtempSync(join(tmpdir(), "runs-"));
}

/** A finished run (has outcome.json) aged `ageDays` old. */
function finishedRun(cwd: string, id: string, ageDays: number) {
  mkdirSync(runDir(cwd, id), { recursive: true });
  writeFileSync(
    outcomePath(cwd, id),
    JSON.stringify({ state: "shipped", iterations: 1, reason: "ok" })
  );
  const t = (NOW - ageDays * DAY) / 1000;
  utimesSync(runDir(cwd, id), t, t);
}

describe("listRuns / readOutcome", () => {
  it("lists run dirs newest-first and parses outcomes", () => {
    const cwd = tmpCwd();
    finishedRun(cwd, "old", 10);
    finishedRun(cwd, "new", 1);

    const runs = listRuns(cwd);
    expect(runs.map((r) => r.id)).toEqual(["new", "old"]);
    expect(readOutcome(cwd, "new")?.state).toBe("shipped");
    expect(readOutcome(cwd, "missing")).toBeNull();
  });

  it("returns [] when there is no runs/ dir", () => {
    expect(listRuns(tmpCwd())).toEqual([]);
  });
});

describe("pruneRuns", () => {
  it("removes old finished runs beyond keepLast, keeps recent + unfinished", () => {
    const cwd = tmpCwd();
    finishedRun(cwd, "fresh", 1);
    finishedRun(cwd, "old-a", 30);
    finishedRun(cwd, "old-b", 40);
    // Unfinished: a binding but no outcome.json — must NEVER be pruned.
    mkdirSync(runDir(cwd, "in-flight"), { recursive: true });
    writeFileSync(bindingPath(cwd, "in-flight"), "---\nid: in-flight\n---\n");
    utimesSync(
      runDir(cwd, "in-flight"),
      (NOW - 50 * DAY) / 1000,
      (NOW - 50 * DAY) / 1000
    );

    const result = pruneRuns(cwd, { keepLast: 1, maxAgeDays: 7, now: NOW });

    expect(result.removed.sort()).toEqual(["old-a", "old-b"]);
    expect(result.kept).toBe(1);
    expect(existsSync(runDir(cwd, "fresh"))).toBe(true);
    expect(existsSync(runDir(cwd, "in-flight"))).toBe(true);
    expect(existsSync(runDir(cwd, "old-a"))).toBe(false);
  });

  it("keepLast protects recent runs from age-based pruning", () => {
    const cwd = tmpCwd();
    finishedRun(cwd, "a", 100);
    finishedRun(cwd, "b", 90);

    const result = pruneRuns(cwd, { keepLast: 5, maxAgeDays: 1, now: NOW });
    expect(result.removed).toEqual([]);
    expect(result.kept).toBe(2);
  });
});
