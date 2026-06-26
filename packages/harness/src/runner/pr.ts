import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Binding } from "../binding";
import { hostedScreenshotPath, screenshotsDir } from "../layout";
import { readLedger } from "../ledger";
import { sq } from "./shell";
import type { Shell } from "./types";

/** Screenshot files the behavior gate captured for this loop, if any. */
function screenshots(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => /\.(png|jpe?g|gif)$/i.test(f))
      .map((f) => join(dir, f))
      .sort();
  } catch {
    return [];
  }
}

const ARTIFACTS_BRANCH = "loop-artifacts";

/**
 * Host the loop's screenshots so they render inline in the PR. Loop artifacts
 * must not pollute the product tree (the conductor guardrail), so they live on
 * ONE shared, non-merging `loop-artifacts` branch (gh-pages style) under
 * `llm/loops/runs/<id>/screenshots/` — appended via a temp index on the branch tip so
 * earlier loops' artifacts survive. All git plumbing, no checkout / working-tree
 * change. Returns raw URLs GitHub renders, or null on any failure so the caller
 * falls back to listing paths rather than failing the PR.
 */
function hostScreenshots(
  id: string,
  shots: string[],
  shell: Shell,
  cwd: string
): { name: string; url: string }[] | null {
  const repo = shell("gh repo view --json nameWithOwner -q .nameWithOwner", {
    cwd
  });
  if (!repo.ok || !repo.output.trim()) return null;
  const slug = repo.output.trim(); // owner/repo

  // Resolve the shared branch's current tip (absent on the first loop ever).
  const fetched = shell(`git fetch origin ${ARTIFACTS_BRANCH}`, { cwd });
  const tip = fetched.ok
    ? shell("git rev-parse FETCH_HEAD", { cwd }).output.trim()
    : "";

  // Build a temp index on top of the tip and add each screenshot.
  const idx = join(mkdtempSync(join(tmpdir(), "loop-idx-")), "index");
  const withIdx = (cmd: string) =>
    shell(`GIT_INDEX_FILE=${sq(idx)} ${cmd}`, { cwd });
  if (tip && !withIdx(`git read-tree ${tip}`).ok) return null;

  const hosted: { name: string; url: string }[] = [];
  for (const path of shots) {
    const h = shell(`git hash-object -w ${sq(path)}`, { cwd });
    if (!h.ok || !h.output.trim()) return null;
    const name = path.split("/").pop() ?? "shot.png";
    const repoPath = hostedScreenshotPath(id, name);
    const add = withIdx(
      `git update-index --add --cacheinfo 100644,${h.output.trim()},${repoPath}`
    );
    if (!add.ok) return null;
    hosted.push({
      name,
      url: `https://raw.githubusercontent.com/${slug}/${ARTIFACTS_BRANCH}/${repoPath}`
    });
  }

  const tree = withIdx("git write-tree");
  if (!tree.ok || !tree.output.trim()) return null;
  const commit = shell(
    `git commit-tree ${tree.output.trim()} ${tip ? `-p ${tip}` : ""} -m ${sq(`chore(loops): screenshots for ${id}`)}`,
    { cwd }
  );
  if (!commit.ok || !commit.output.trim()) return null;
  // Non-force append; a stale tip (a concurrent loop pushed) just fails → paths.
  const push = shell(
    `git push origin ${commit.output.trim()}:refs/heads/${ARTIFACTS_BRANCH}`,
    { cwd }
  );
  if (!push.ok) return null;

  return hosted;
}

/** Sort key + label so before/after captures read in the right order. */
function shotRank(name: string): number {
  if (/before/i.test(name)) return 0;
  if (/after/i.test(name)) return 1;
  return 2;
}
function shotLabel(name: string): string | null {
  if (/before/i.test(name)) return "**Before**";
  if (/after/i.test(name)) return "**After**";
  return null;
}

/** The "Behavior verification" section: embedded images if hosted, else paths. */
function behaviorSection(
  hosted: { name: string; url: string }[] | null,
  shots: string[]
): string[] {
  if (hosted && hosted.length > 0) {
    const ordered = [...hosted].sort(
      (a, b) => shotRank(a.name) - shotRank(b.name)
    );
    const out = ["### Behavior verification"];
    for (const h of ordered) {
      const label = shotLabel(h.name);
      if (label) out.push(label, "");
      out.push(`![${h.name}](${h.url})`, "");
    }
    return out;
  }
  if (shots.length > 0) {
    return [
      "### Behavior verification",
      "_captured locally (hosting unavailable):_",
      ...shots.map((s) => `- \`${s}\``),
      ""
    ];
  }
  return [];
}

/**
 * Push the loop branch and open a **gated** PR (never merged). The body carries
 * the design rationale surface: acceptance checklist, embedded behavior-gate
 * screenshots, and the full ledger, so a human reviewer sees every kept/reverted
 * iteration and why. Returns the PR URL.
 */
export function openPr(
  binding: Binding,
  ledgerPath: string,
  shell: Shell,
  cwd: string,
  /** PR base branch. Defaults to the repo default (main); pass the loop's base
   *  branch to show only the loop's commit when it wasn't branched off main. */
  base?: string
): string {
  const ledger = readLedger(ledgerPath);
  const kept = ledger.filter((e) => e.decision === "keep").length;
  const shots = screenshots(screenshotsDir(cwd, binding.id));
  const hosted =
    shots.length > 0 ? hostScreenshots(binding.id, shots, shell, cwd) : null;

  const body = [
    `## ${binding.title}`,
    "",
    `**Kind:** ${binding.kind} · **Risk:** ${binding.risk}`,
    "",
    ...(binding.issue ? [`Closes #${binding.issue}`, ""] : []),
    "### Acceptance",
    ...binding.acceptance.map((c) => `- [x] ${c}`),
    "",
    ...behaviorSection(hosted, shots),
    "### Ledger",
    ...ledger.map(
      (e) => `- #${e.iteration} **${e.decision}** — ${e.change} _(${e.reason})_`
    ),
    "",
    `_Conducted headless: ${kept} kept / ${ledger.length} iterations. ` +
      `Gated PR — requires human review, do not auto-merge._`
  ].join("\n");

  const bodyFile = join(mkdtempSync(join(tmpdir(), "loop-pr-")), "body.md");
  writeFileSync(bodyFile, body);

  const push = shell("git push -u origin HEAD", { cwd });
  if (!push.ok) throw new Error(`git push failed: ${push.output}`);

  // Idempotent: a PR may already exist for this branch (re-entry — addressing
  // review feedback in the same worktree). Update its body and return it rather
  // than failing on `gh pr create`. `gh pr view` errors (ok:false) when none.
  const existing = shell("gh pr view --json url --jq .url", { cwd });
  if (existing.ok && existing.output.trim().startsWith("http")) {
    shell(`gh pr edit --body-file ${sq(bodyFile)}`, { cwd });
    return firstHttpUrl(existing.output);
  }

  const title = `loop(${binding.id}): ${binding.title}`;
  const baseArg = base ? ` --base ${sq(base)}` : "";
  const r = shell(
    `gh pr create --title ${sq(title)} --body-file ${sq(bodyFile)}${baseArg}`,
    { cwd }
  );
  if (!r.ok) throw new Error(`gh pr create failed: ${r.output}`);

  return firstHttpUrl(r.output);
}

/** The last `http…` line in command output (gh prints the URL last). */
function firstHttpUrl(output: string): string {
  return (
    output
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("http"))
      .at(-1) ?? output.trim()
  );
}
