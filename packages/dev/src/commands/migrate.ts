import { existsSync } from "node:fs";
import { intro, log, outro, tasks } from "@clack/prompts";
import { config as loadDotenv } from "dotenv";
import { execa } from "execa";
import { join } from "pathe";
import { requireNumberEnv, tryConnect } from "../helpers.js";
import { applyMigrations } from "../services/migrations.js";
import { getWorktreeRoot } from "../worktree.js";

// Run database migrations against the worktree's local stack without booting
// the full compose stack. Reads PORT_DB from `.env.local` (written by
// `crbn up`). Bare `pnpm db:migrate` resolves dotenv relative to cwd and falls
// through to the supabase CLI's linked-project path — `crbn migrate` removes
// that footgun by always targeting the current worktree's DB.
export async function migrate(opts: { regen?: boolean } = {}) {
  const shouldRegen = opts.regen ?? true;
  intro("Carbon · dev migrate");

  const root = await getWorktreeRoot();
  const envLocal = join(root, ".env.local");
  if (!existsSync(envLocal)) {
    log.error(
      `.env.local not found in ${root}. Run \`crbn up\` once to provision the stack, then re-run \`crbn migrate\`.`
    );
    outro("");
    process.exit(1);
  }

  loadDotenv({ path: envLocal, override: false });
  loadDotenv({ path: join(root, ".env"), override: false });

  let portDb: number;
  try {
    portDb = requireNumberEnv("PORT_DB");
  } catch (err) {
    log.error(
      `${(err as Error).message}. Re-run \`crbn up\` to regenerate .env.local.`
    );
    outro("");
    process.exit(1);
  }

  if (!(await tryConnect("127.0.0.1", portDb, 1500))) {
    log.error(
      `Local DB at 127.0.0.1:${portDb} is not reachable. Start the stack first: \`crbn up\`.`
    );
    outro("");
    process.exit(1);
  }

  let applied = false;
  await tasks([
    {
      title: "Apply database migrations",
      task: async () => {
        const r = await applyMigrations(root, portDb);
        applied = r.applied;
        return r.applied ? "migrations applied" : "schema already up to date";
      }
    },
    ...(shouldRegen
      ? [
          {
            title: "Regenerate types & swagger",
            task: async () => {
              if (!applied) return "skipped (no new migrations)";
              await execa("pnpm", ["db:types"], { cwd: root });
              await execa("pnpm", ["generate:swagger"], { cwd: root });
              return "types + swagger refreshed";
            }
          }
        ]
      : [])
  ]);

  outro("done");
}
