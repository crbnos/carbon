import { existsSync } from "node:fs";
import { intro, log, outro } from "@clack/prompts";
import { execa } from "execa";
import { join } from "pathe";
import pc from "picocolors";
import { currentBranch, isLinkedWorktree, mainCheckoutRoot } from "../git.js";
import {
  canonicalSlug,
  ensureSlugAvailable,
  getWorktreeRoot,
  persistSlug,
  projectName
} from "../worktree.js";
import { syncStaleCopyFiles } from "./copy.js";

// `crbn init` — provision the CURRENT worktree so it matches a `crbn checkout`
// worktree: a deterministic, branch-derived slug (`.carbon-worktree`), the
// copy-files (`.env`) synced from the main checkout, and the AI skills linked.
// Idempotent. Leaves the heavy stack boot — ports, `.env.local`, containers —
// to `crbn up`. Shared by `crbn new`, the `checkout` post-create hook, and
// Conductor's `setup` script (which creates the worktree itself, then calls us).
export async function initWorktree(opts?: {
  /** Worktree to provision. Defaults to the current one. */
  root?: string;
  /** Sync `.env` (and other package.json#crbn.copy files) from main. */
  copyEnv?: boolean;
  /** Suppress clack output — for use inside another command's task spinner. */
  quiet?: boolean;
}) {
  const root = opts?.root ?? (await getWorktreeRoot());
  const copyEnv = opts?.copyEnv !== false;
  const quiet = opts?.quiet === true;
  const say = (fn: () => void) => {
    if (!quiet) fn();
  };

  say(() => intro("Carbon · init worktree"));

  // Never re-slug the main checkout — that would clobber its `.carbon-worktree`
  // and collapse every linked worktree onto the main stack.
  if (!(await isLinkedWorktree(root))) {
    say(() =>
      log.warn("main checkout — nothing to initialize (init is for worktrees)")
    );
    say(() => outro(""));
    return;
  }

  const mainRoot = await mainCheckoutRoot(root);
  const branch = await currentBranch(root);
  const slug = canonicalSlug({ worktreeRoot: root, mainRoot, branch });

  // Refuse to steal a slug that a *different* live stack already owns. No-op
  // (returns silently) when Docker isn't running yet — common during setup.
  await ensureSlugAvailable(slug, root);
  persistSlug(root, slug);
  say(() =>
    log.info(`worktree: ${pc.cyan(slug)}  (project ${projectName(slug)})`)
  );

  if (copyEnv) {
    const copied = await syncStaleCopyFiles(root);
    say(() =>
      log.info(
        copied.length
          ? `synced from main: ${copied.join(", ")}`
          : "copy-files already current"
      )
    );
  }

  await installSkills(root, say);

  say(() => outro(`ready — ${pc.cyan("crbn up")} to boot the stack`));
}

// Link `.ai` rules/skills into `.claude`/`.codex` (both gitignored, so absent in
// a fresh worktree). Idempotent — the script re-points existing symlinks.
async function installSkills(root: string, say: (fn: () => void) => void) {
  const script = join(root, ".ai", "scripts", "install-skills.sh");
  if (!existsSync(script)) return;
  const r = await execa("bash", [script], { cwd: root, reject: false });
  say(() =>
    r.exitCode === 0
      ? log.info("skills linked into .claude/.codex")
      : log.warn("install-skills step failed (worktree still initialized)")
  );
}
