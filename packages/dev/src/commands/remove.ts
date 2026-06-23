import {
  cancel,
  intro,
  isCancel,
  log,
  multiselect,
  outro,
  spinner
} from "@clack/prompts";
import pc from "picocolors";
import {
  deleteBranch,
  listWorktrees as gitListWorktrees,
  isDirty,
  mainCheckoutRoot,
  removeWorktree
} from "../git.js";
import { confirmRemove } from "../prompts.js";
import { destroyProjectVolumes, flushDb } from "../services/compose.js";
import {
  branchToPrefix,
  pruneStaleRoutes,
  unregisterAliases
} from "../services/portless.js";
import {
  getSlot,
  listSlugs,
  projectName,
  removeSlot,
  slugForWorktreePath
} from "../worktree.js";

export async function removeWorktreeCmd(opts?: { prune?: boolean }) {
  const pruneBranches = opts?.prune === true;
  intro("Carbon · remove worktree");

  const wtsAll = await gitListWorktrees();
  const mainRoot = await mainCheckoutRoot();
  const wts = wtsAll.filter(
    (w) => !w.bare && !w.current && w.path !== mainRoot
  );
  if (wts.length === 0) {
    log.warn("no other worktrees to remove");
    outro("");
    return;
  }

  const choices = await multiselect({
    message: "Worktrees to remove",
    options: wts.map((w) => ({
      value: w.path,
      label: `${w.branch ?? "(detached)"}  ${pc.dim(w.path)}`
    })),
    required: true
  });
  if (isCancel(choices)) {
    cancel("aborted");
    process.exit(0);
  }
  const selectedPaths = choices as string[];
  const targets = selectedPaths.map((p) => wts.find((w) => w.path === p)!);

  const registry = listSlugs();

  // Build context once (isDirty, slug, etc.) — reused for warnings + removal.
  const jobs = await Promise.all(
    targets.map(async (target) => {
      const slug = slugForWorktreePath(target.path, registry);
      return {
        target,
        dirty: await isDirty(target.path),
        slug,
        projectLabel: slug ? projectName(slug) : null,
        slotInfo: slug ? getSlot(slug) : null,
        branchPrefix: slug ? branchToPrefix(target.branch, slug) : null
      };
    })
  );

  // Show warnings and confirm for each target.
  for (const job of jobs) {
    const { target, dirty, slug, projectLabel } = job;

    const warnings: string[] = [];
    if (dirty)
      warnings.push(
        `${pc.yellow("⚠")} uncommitted changes will be LOST (force remove)`
      );
    if (slug)
      warnings.push(
        `${pc.yellow("⚠")} stack ${projectLabel} will be destroyed (volumes wiped)`
      );
    if (pruneBranches && target.branch)
      warnings.push(
        `${pc.yellow("⚠")} branch '${target.branch}' will be force-deleted (git branch -D, even if unmerged)`
      );
    if (warnings.length)
      log.warn(`${target.branch ?? target.path}\n${warnings.join("\n")}`);

    const ok = await confirmRemove({
      branchOrPath: target.branch ?? target.path,
      hasStack: !!slug
    });
    if (!ok) {
      cancel("aborted");
      process.exit(0);
    }
  }

  const s = spinner();
  let done = 0;
  const total = jobs.length;
  const needsPrune = jobs.some((j) => j.branchPrefix);

  const progress = (label: string) => {
    s.message(`(${done}/${total}) ${label}`);
  };

  s.start(`Removing ${total} worktree${total > 1 ? "s" : ""}`);

  // Run all removals concurrently.
  const results = await Promise.allSettled(
    jobs.map(async (job) => {
      const label = job.target.branch ?? job.target.path;
      const { target, dirty, slug, projectLabel, slotInfo, branchPrefix } = job;

      if (branchPrefix) {
        progress(`${label}: unregistering aliases`);
        await unregisterAliases(target.path, branchPrefix);
      }
      if (slug && projectLabel) {
        progress(`${label}: tearing down stack`);
        await destroyProjectVolumes(target.path, projectLabel);
      }
      if (slotInfo && typeof slotInfo.redisDb === "number") {
        progress(`${label}: flushing redis db ${slotInfo.redisDb}`);
        await flushDb(slotInfo.redisDb);
      }

      progress(`${label}: removing worktree`);
      await removeWorktree(target.path, dirty);

      if (pruneBranches && target.branch) {
        progress(`${label}: deleting branch`);
        await deleteBranch(target.branch);
      }

      if (slug) removeSlot(slug);

      done++;
      progress(pc.green(label));
    })
  );

  // One global prune after all aliases removed.
  if (needsPrune) {
    s.message("pruning stale routes");
    await pruneStaleRoutes();
  }

  s.stop(`Removed ${done}/${total} worktree${total > 1 ? "s" : ""}`);

  // Report failures.
  const failed = results.filter(
    (r): r is PromiseRejectedResult => r.status === "rejected"
  );
  for (let i = 0; i < results.length; i++) {
    if (results[i]!.status === "rejected") {
      const label = jobs[i]!.target.branch ?? jobs[i]!.target.path;
      log.error(
        `${label}: ${(results[i] as PromiseRejectedResult).reason?.message ?? "unknown error"}`
      );
    }
  }

  outro(failed.length ? `done with ${failed.length} error(s)` : "done");
}
