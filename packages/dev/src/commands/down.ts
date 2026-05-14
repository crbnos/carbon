import { intro, outro, tasks } from "@clack/prompts";
import pc from "picocolors";
import { syncAppPortlessConfigs } from "../env.js";
import { currentBranch, isLinkedWorktree } from "../git.js";
import { stopStack } from "../services/compose.js";
import { branchToPrefix, unregisterAliases } from "../services/portless.js";
import { getWorktreeRoot, projectName, resolveSlug } from "../worktree.js";

// silent: post-SIGINT path. clack tasks/spinner would EIO via setRawMode on
// the freshly-interrupted stdin; fall back to plain printf progress.
export async function down(opts: { silent?: boolean } = {}) {
  const root = await getWorktreeRoot();
  const slug = resolveSlug(root);
  const project = projectName(slug);

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
      title: "Reset app portless.json",
      task: async () => {
        const linked = await isLinkedWorktree();
        syncAppPortlessConfigs({
          worktreeRoot: root,
          branchPrefix: null,
          linked
        });
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

  step("resetting app portless.json");
  const linked = await isLinkedWorktree();
  syncAppPortlessConfigs({ worktreeRoot: root, branchPrefix: null, linked });
  done("configs reset");
}
