// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// `pnpm --filter @carbon/checks learn:sweep`: the weekly backstop of the
// learning loop. Reads the signal inbox, recent fix commits and (with gh)
// failed CI checks, and writes .ai/runs/<date>-learn-sweep.md. /learn's sweep
// mode turns each row into a store change; a human reviews the pull request.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readSignals, type Signal } from "../learn/inbox";
import { type Commit, fixCommitSignals, groupSignals } from "../learn/sweep";
import { repoRoot } from "../sources/migrations";

const DAY_MS = 24 * 60 * 60 * 1000;
const root = repoRoot();
const run = (cmd: string, args: string[]) =>
  execFileSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });

// Absolute instants: the window is "the last 7 days", in any zone.
const since = new Date(Date.now() - 7 * DAY_MS).toISOString();
const today = run("date", ["-u", "+%Y-%m-%d"]).trim();

/** Shared lockfiles, catalogs and generated files would tie every fix to every commit. */
const isSourceFile = (file: string) =>
  /^(apps|packages)\//.test(file) &&
  /\.(ts|tsx|sql)$/.test(file) &&
  !/\.(test|spec)\.tsx?$/.test(file) &&
  !file.includes("/generated") &&
  !file.endsWith("/types.ts");

const MAX_ROWS = 30;

function readCommits(): Commit[] {
  const out = run("git", [
    "log",
    "--since=21.days",
    "--no-merges",
    "--name-only",
    "--format=%x1e%H%x1f%cI%x1f%s"
  ]);
  return out
    .split("\x1e")
    .filter((chunk) => chunk.trim() !== "")
    .map((chunk) => {
      const [header = "", ...files] = chunk.split("\n");
      const [sha = "", at = "", subject = ""] = header.split("\x1f");
      return { sha, at, subject, files: files.filter(isSourceFile) };
    });
}

/** Failed conformance checks from CI, as signals. Empty without gh. */
function readCiSignals(): { signals: Signal[]; note: string } {
  try {
    const runs = JSON.parse(
      run("gh", [
        "run",
        "list",
        "--workflow=check.yml",
        "--status=failure",
        "--limit",
        "30",
        "--json",
        "databaseId,headBranch,createdAt"
      ])
    ) as { databaseId: number; headBranch: string; createdAt: string }[];
    const signals: Signal[] = [];
    for (const ci of runs) {
      if (Date.parse(ci.createdAt) < Date.parse(since)) continue;
      let log = "";
      try {
        log = run("gh", ["run", "view", String(ci.databaseId), "--log-failed"]);
      } catch {
        continue;
      }
      const start = log.indexOf("New conformance violations:");
      if (start === -1) continue;
      for (const line of log.slice(start).split("\n").slice(1, 200)) {
        const match = line.match(/\s([a-z0-9-]+)\s{2}(\S+?):\d+\s/);
        if (!match) continue;
        signals.push({
          kind: "gate-failure",
          at: ci.createdAt,
          worktree: `ci:${ci.headBranch}`,
          branch: ci.headBranch,
          checkId: match[1],
          file: match[2]
        });
      }
    }
    return { signals, note: `CI: ${runs.length} failed check.yml runs read.` };
  } catch {
    return { signals: [], note: "CI: gh is not available, so CI was skipped." };
  }
}

const ci = readCiSignals();
const repeated = groupSignals([...readSignals(), ...ci.signals], since);
// Fewest earlier commits first: the most targeted link to a mistake leads.
const fixes = fixCommitSignals(readCommits()).sort(
  (a, b) => a.earlier.length - b.earlier.length
);

const lines = [
  `# Learn sweep, ${today}`,
  "",
  `Signals since ${since}. ${ci.note}`,
  "",
  "## Repeated check failures",
  "",
  repeated.length === 0
    ? "No check failed 2 or more times."
    : [
        "A check that keeps failing means the briefing did not reach the writer, or the check's fix is unclear. Run /learn on each row.",
        "",
        "| Check | Failures | Worktrees | Files |",
        "|---|---|---|---|",
        ...repeated.map(
          (r) =>
            `| \`${r.checkId}\` | ${r.count} | ${r.worktrees} | ${r.files.slice(0, 5).join(", ")} |`
        )
      ].join("\n"),
  "",
  "## Fixes that may hold an unrecorded mistake",
  "",
  fixes.length === 0
    ? "No fix commit changed a file that another commit changed in the 14 days before it."
    : [
        "Each fix changed a file that an earlier commit changed. If the earlier commit made the mistake, run /learn on it.",
        "",
        "| Fix | Subject | Earlier commits |",
        "|---|---|---|",
        ...fixes
          .slice(0, MAX_ROWS)
          .map(
            (f) =>
              `| ${f.sha.slice(0, 10)} | ${f.subject.replace(/\|/g, "\\|")} | ${f.earlier.map((s) => s.slice(0, 10)).join(", ")} |`
          ),
        ...(fixes.length > MAX_ROWS
          ? ["", `${fixes.length - MAX_ROWS} more fixes are not listed.`]
          : [])
      ].join("\n"),
  ""
];

const dir = join(root, ".ai/runs");
mkdirSync(dir, { recursive: true });
const path = join(dir, `${today}-learn-sweep.md`);
writeFileSync(path, lines.join("\n"));
process.stdout.write(
  `Wrote .ai/runs/${today}-learn-sweep.md: ${repeated.length} repeated checks, ${fixes.length} fixes.\n`
);
