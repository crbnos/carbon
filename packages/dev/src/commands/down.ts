import { intro, outro, tasks } from "@clack/prompts";
import pc from "picocolors";
import { syncAppPortlessConfigs } from "../env.js";
import { currentBranch } from "../git.js";
import { stopStack } from "../services/compose.js";
import { branchToPrefix, unregisterAliases } from "../services/portless.js";
import {
  ensureSlugAvailable,
  getWorktreeRoot,
  projectName,
  resolveSlug
} from "../worktree.js";

// silent: post-SIGINT path. clack tasks/spinner would EIO via setRawMode on
// the freshly-interrupted stdin; fall back to plain printf progress.
export async function down(opts: { silent?: boolean } = {}) {
  const root = await getWorktreeRoot();
  const slug = resolveSlug(root);
  const project = projectName(slug);

  // Refuse to tear down a stack that another worktree owns (same slug, different
  // path). Passes for our own stack and when nothing is running.
  await ensureSlugAvailable(slug, root);

  if (opts.silent) {
    return runPlain(root, slug, project);
  }

  intro("Carbon · dev down");
  await tasks([
    {
      title: `Stopping ${project} (volumes preserved)`,
      task: async (msg) => {
        msg("docker compose stop");
        await stopStack(root, slug, false);
        return "stack stopped";
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
    }
  ]);
  outro("stopped");
}

async function runPlain(root: string, slug: string, project: string) {
  const step = (msg: string) =>
    process.stderr.write(`${pc.cyan("•")} ${msg}…\n`);
  const done = (msg: string) =>
    process.stderr.write(`${pc.green("✓")} ${msg}\n`);

  step(`stopping ${project} (volumes preserved)`);
  await stopStack(root, slug, false);
  done("stack stopped");

  step("unregistering portless aliases");
  const branch = await currentBranch(root);
  const branchPrefix = branchToPrefix(branch, slug);
  await unregisterAliases(root, branchPrefix);
  done("aliases removed");

  step("cleaning up portless.json");
  syncAppPortlessConfigs(root);
  done("configs reset");
}
