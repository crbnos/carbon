import { execFileSync } from "node:child_process";
import { findClobbers, type SourceFile } from "../clobber";
import { repoRoot } from "../sources/migrations";

const MIGRATIONS = "packages/database/supabase/migrations";

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function filesChanged(root: string, base: string, head: string): string[] {
  const out = git(root, [
    "diff",
    "--name-only",
    "--diff-filter=AM",
    `${base}...${head}`,
    "--",
    MIGRATIONS
  ]);
  return out ? out.split("\n").filter(Boolean) : [];
}

function readAt(root: string, ref: string, path: string): SourceFile | null {
  try {
    return {
      file: path.replace(`${MIGRATIONS}/`, ""),
      contents: git(root, ["show", `${ref}:${path}`])
    };
  } catch {
    return null;
  }
}

function main() {
  const root = repoRoot();
  const mainRef = process.env.CLOBBER_BASE_REF ?? "origin/main";
  let base: string;
  try {
    base = git(root, ["merge-base", "HEAD", mainRef]);
  } catch {
    console.error(
      `Could not compute merge-base with ${mainRef}. Fetch it first (git fetch origin main).`
    );
    process.exit(2);
    return;
  }
  const branchFiles = filesChanged(root, base, "HEAD")
    .map((p) => readAt(root, "HEAD", p))
    .filter((f): f is SourceFile => f !== null);
  const mainFiles = filesChanged(root, base, mainRef)
    .map((p) => readAt(root, mainRef, p))
    .filter((f): f is SourceFile => f !== null);

  const clobbers = findClobbers(branchFiles, mainFiles);
  if (clobbers.length === 0) {
    console.log(
      `No clobber risks vs ${mainRef} (merge-base ${base.slice(0, 9)}).`
    );
    process.exit(0);
  }
  for (const c of clobbers)
    console.log(`CLOBBER  ${c.snippet}\n  ${c.message}`);
  process.exit(1);
}

main();
