import { intro, log, outro, tasks } from "@clack/prompts";
import pc from "picocolors";
import { syncAppPortlessConfigs } from "../env.js";
import { currentBranch } from "../git.js";
import { killOrphanedApps, killOrphanedStripe } from "../services/apps.js";
import { flushDb, stopStack } from "../services/compose.js";
import { branchToPrefix, unregisterAliases } from "../services/portless.js";
import {
  getSlot,
  getWorktreeRoot,
  projectName,
  removeSlot,
  resolveSlug
} from "../worktree.js";

// silent: post-SIGINT path. clack tasks/spinner would EIO via setRawMode on
// the freshly-interrupted stdin; fall back to plain printf progress.
// volumes: also drop the stack's Docker volumes (data is wiped) — for headless
// dispatch teardown where leftover volumes would accumulate on a long-lived box.
export async function down(
  opts: { silent?: boolean; volumes?: boolean; purge?: boolean } = {}
) {
  const root = await getWorktreeRoot();
  const slug = resolveSlug(root);
  const project = projectName(slug);
  const purge = opts.purge ?? false;
  // Purge is a full teardown (workspace archive/removal) — it implies volumes.
  const withVolumes = (opts.volumes ?? false) || purge;

  // No ensureSlugAvailable guard here — `down` is the user explicitly asking
  // to stop their own stack. The guard (meant for `up`) would block teardown
  // of moved/borrowed/stale worktrees, leaving containers orphaned.

  if (opts.silent) {
    return runPlain(root, slug, project, withVolumes, purge);
  }

  intro("Carbon · dev down");
  await tasks([
    {
      title: `Stopping ${project} (${withVolumes ? "removing volumes" : "volumes preserved"})`,
      task: async (msg) => {
        msg(withVolumes ? "docker compose down -v" : "docker compose down");
        const code = await stopStack(root, slug, withVolumes);
        if (code !== 0) {
          log.warn("stack stop failed — containers may still be running");
          return "partial — check `crbn status`";
        }
        return withVolumes ? "stack stopped, volumes removed" : "stack stopped";
      }
    },
    {
      title: "Kill orphaned dev servers & stripe listener",
      task: async () => {
        const slot = getSlot(slug);
        if (slot) await killOrphanedApps(slot.ports);
        await killOrphanedStripe(root);
        return "orphaned processes killed";
      }
    },
    {
      title: "Unregister portless aliases",
      task: async () => {
        const branch = await currentBranch(root);
        const branchPrefix = branchToPrefix(branch, slug);
        await unregisterAliases(root, branchPrefix);
        return "aliases removed";
      }
    },
    {
      title: "Clean up portless.json",
      task: async () => {
        syncAppPortlessConfigs(root);
        return "configs reset";
      }
    },
    // Purge: release the worktree's registry slot (ports/jwt) and flush its
    // redis db, so archived/removed workspaces don't leak slots from the pool.
    ...(purge
      ? [
          {
            title: "Release port slot + flush redis",
            task: async () => {
              const slot = getSlot(slug);
              if (slot && typeof slot.redisDb === "number") {
                await flushDb(slot.redisDb);
              }
              removeSlot(slug);
              return "slot released";
            }
          }
        ]
      : [])
  ]);
  outro(purge ? "stopped and purged" : "stopped");
}

async function runPlain(
  root: string,
  slug: string,
  project: string,
  withVolumes: boolean,
  purge: boolean
) {
  const step = (msg: string) =>
    process.stderr.write(`${pc.cyan("•")} ${msg}…\n`);
  const done = (msg: string) =>
    process.stderr.write(`${pc.green("✓")} ${msg}\n`);

  step(
    `stopping ${project} (${withVolumes ? "removing volumes" : "volumes preserved"})`
  );
  const code = await stopStack(root, slug, withVolumes);
  if (code !== 0) {
    process.stderr.write(
      `${pc.yellow("!")} stack stop failed — containers may still be running\n`
    );
  }
  done(withVolumes ? "stack stopped, volumes removed" : "stack stopped");

  step("killing orphaned dev servers & stripe listener");
  const slot = getSlot(slug);
  if (slot) await killOrphanedApps(slot.ports);
  await killOrphanedStripe(root);
  done("orphaned processes killed");

  step("unregistering portless aliases");
  const branch = await currentBranch(root);
  const branchPrefix = branchToPrefix(branch, slug);
  await unregisterAliases(root, branchPrefix);
  done("aliases removed");

  step("cleaning up portless.json");
  syncAppPortlessConfigs(root);
  done("configs reset");

  if (purge) {
    step("releasing port slot + flushing redis");
    const slot = getSlot(slug);
    if (slot && typeof slot.redisDb === "number") await flushDb(slot.redisDb);
    removeSlot(slug);
    done("slot released");
  }
}
