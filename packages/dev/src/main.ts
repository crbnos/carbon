import { defineCommand, runMain } from "citty";
import { copy } from "./commands/copy.js";
import { down } from "./commands/down.js";
import { listWorktrees } from "./commands/list.js";
import { migrate } from "./commands/migrate.js";
import { newWorktree } from "./commands/new.js";
import { removeWorktreeCmd } from "./commands/remove.js";
import { reset } from "./commands/reset.js";
import { status } from "./commands/status.js";
import { up } from "./commands/up.js";

const main = defineCommand({
  meta: {
    name: "crbn",
    description: "Carbon dev CLI (heavy commands; bash router handles checkout)"
  },
  subCommands: {
    up: defineCommand({
      meta: { description: "Boot the per-worktree compose stack and apps" },
      args: {
        migrate: {
          type: "boolean",
          default: true,
          description: "Apply database migrations (use --no-migrate to skip)"
        },
        regen: {
          type: "boolean",
          default: true,
          description:
            "Regenerate db types + swagger after migrations (use --no-regen to skip)"
        },
        apps: {
          type: "boolean",
          default: true,
          description:
            "Spawn ERP/MES dev servers (use --no-apps for services-only boot)"
        },
        pull: {
          type: "boolean",
          default: false,
          description:
            "Always docker compose pull (default: skip when all images exist locally)"
        }
      },
      run: ({ args }) =>
        up({
          migrate: args.migrate !== false,
          regen: args.regen !== false,
          apps: args.apps !== false,
          pull: args.pull === true
        })
    }),
    down: defineCommand({
      meta: { description: "Stop the compose stack (volumes preserved)" },
      run: () => down()
    }),
    reset: defineCommand({
      meta: { description: "Wipe volumes + flush redis db, then `up`" },
      run: () => reset()
    }),
    status: defineCommand({
      meta: { description: "Show port assignment + container health" },
      run: () => status()
    }),
    migrate: defineCommand({
      meta: {
        description:
          "Apply database migrations against the worktree's stack (loads .env.local)"
      },
      args: {
        regen: {
          type: "boolean",
          default: true,
          description:
            "Regenerate db types + swagger after migrations (use --no-regen to skip)"
        }
      },
      run: ({ args }) => migrate({ regen: args.regen !== false })
    }),
    new: defineCommand({
      meta: { description: "Interactive: create a worktree on a fresh branch" },
      run: () => newWorktree()
    }),
    list: defineCommand({
      meta: { description: "List worktrees with stack status" },
      run: () => listWorktrees()
    }),
    remove: defineCommand({
      meta: { description: "Pick a worktree to delete (with stack teardown)" },
      run: () => removeWorktreeCmd()
    }),
    copy: defineCommand({
      meta: {
        description:
          "Copy files listed in package.json#crbn.copy from main checkout into cwd"
      },
      run: () => copy()
    }),
    // Stubs so shell completion lists these — the bash router (`bin/crbn`)
    // intercepts them before tsx is invoked. Direct invocation lands here.
    checkout: defineCommand({
      meta: {
        description:
          "Switch into worktree for <branch> (handled by bash router)"
      },
      run: () => {
        console.error("checkout is handled by the bash router (bin/crbn)");
        process.exit(1);
      }
    })
  }
});

try {
  const { default: tab } = await import("@bomb.sh/tab/citty");
  await tab(main);
} catch {
  // Optional: shell completions only; continue if the package is missing (run `pnpm install`).
}
await runMain(main);
