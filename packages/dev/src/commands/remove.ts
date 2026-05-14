import {
  cancel,
  intro,
  isCancel,
  log,
  outro,
  select,
  tasks
} from "@clack/prompts";
import pc from "picocolors";
import {
  listWorktrees as gitListWorktrees,
  isDirty,
  removeWorktree
} from "../git.js";
import { confirmRemove } from "../prompts.js";
import { destroyProjectVolumes, flushDb } from "../services/compose.js";
import { getSlot, listSlugs, removeSlot } from "../worktree.js";

export async function removeWorktreeCmd() {
  intro("Carbon · remove worktree");

  const wtsAll = await gitListWorktrees();
  const wts = wtsAll.filter((w) => !w.bare && !w.current);
  if (wts.length === 0) {
    log.warn("no other worktrees to remove");
    outro("");
    return;
  }

  const choice = await select({
    message: "Worktree to remove",
    options: wts.map((w) => ({
      value: w.path,
      label: `${w.branch ?? "(detached)"}  ${pc.dim(w.path)}`
    }))
  });
  if (isCancel(choice)) {
    cancel("aborted");
    process.exit(0);
  }
  const targetPath = choice as string;
  const target = wts.find((w) => w.path === targetPath)!;

  const dirty = await isDirty(targetPath);
  const registry = listSlugs();
  const slug = slugForPath(targetPath, registry);
  const projectLabel = slug ? `carbon-${slug}` : "(no stack)";

  const warnings: string[] = [];
  if (dirty) warnings.push(`${pc.yellow("⚠")} uncommitted changes in worktree`);
  if (slug)
    warnings.push(
      `${pc.yellow("⚠")} stack ${projectLabel} will be destroyed (volumes wiped)`
    );
  if (warnings.length) log.warn(warnings.join("\n"));

  const ok = await confirmRemove({
    branchOrPath: target.branch ?? targetPath,
    hasStack: !!slug
  });
  if (!ok) {
    cancel("aborted");
    process.exit(0);
  }

  const slotInfo = slug ? getSlot(slug) : null;
  await tasks([
    ...(slug
      ? [
          {
            title: `docker compose down -v · ${projectLabel}`,
            task: async () => {
              await destroyProjectVolumes(targetPath, projectLabel);
              return "stack removed";
            }
          }
        ]
      : []),
    ...(slotInfo && typeof slotInfo.redisDb === "number"
      ? [
          {
            title: `Flush redis db ${slotInfo.redisDb}`,
            task: async () => {
              await flushDb(slotInfo.redisDb);
              return "redis db flushed";
            }
          }
        ]
      : []),
    {
      title: `git worktree remove ${targetPath}`,
      task: async () => {
        await removeWorktree(targetPath, dirty);
        return "worktree removed";
      }
    },
    ...(slug
      ? [
          {
            title: "Prune port registry",
            task: async () => {
              removeSlot(slug);
              return `removed ${slug}`;
            }
          }
        ]
      : [])
  ]);

  outro("done");
}

function slugForPath(
  path: string,
  registry: ReturnType<typeof listSlugs>
): string | null {
  for (const [slug, entry] of Object.entries(registry)) {
    if (entry.worktreeRoot === path) return slug;
  }
  return null;
}
