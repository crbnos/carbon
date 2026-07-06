import { box, intro, log, outro, progress, tasks } from "@clack/prompts";
import { config as loadDotenv } from "dotenv";
import { execa } from "execa";
import { join } from "pathe";
import type { AppId } from "../constants.js";
import { renderEnv, syncAppPortlessConfigs, writeEnv } from "../env.js";
import { currentBranch } from "../git.js";
import { onShutdown } from "../helpers.js";
import { pickApps, pickBorrowSlug } from "../prompts.js";
import {
  installDeps,
  spawnApps,
  spawnStripeListener,
  syncEnvSymlinks
} from "../services/apps.js";
import {
  allImagesPresentLocally,
  bootSharedRedis,
  bootStack,
  type Container,
  devComposeImageRefs,
  listComposeServices,
  listContainers,
  pullStack,
  restartServices,
  tailServiceLogs
} from "../services/compose.js";
import {
  applyBootstrapSql,
  applyMigrations,
  ensureSmokeTestUser,
  waitForPostgres,
  waitForStorageReady,
  waitForTcp
} from "../services/migrations.js";
import {
  branchToPrefix,
  ensurePortlessInstalled,
  ensureProxyPrivileges,
  hostsFileInSync,
  proxyRunsAsRoot,
  pruneStaleRoutes,
  registerAliases,
  startProxyDaemon,
  syncHostsFile,
  waitForProxyReady
} from "../services/portless.js";
import { summaryLines } from "../ui.js";
import {
  ensureSlugAvailable,
  getSlot,
  getWorktreeRoot,
  type JwtCreds,
  type PortMap,
  persistSlug,
  projectName,
  resolveSlot,
  resolveSlug,
  SHARED_REDIS_PORT
} from "../worktree.js";
import { syncStaleCopyFiles } from "./copy.js";
import { down } from "./down.js";

type UpOpts = {
  migrate?: boolean;
  regen?: boolean;
  apps?: boolean;
  /** When true, always `docker compose pull` even if images exist locally. */
  pull?: boolean;
  /** When true, show a picker to borrow another worktree's running containers. */
  borrow?: boolean;
  /** When false, skip portless proxy and use localhost URLs. */
  portless?: boolean;
};

type Ctx = {
  root: string;
  slug: string;
  ports: PortMap;
  redisDb: number;
  jwt: JwtCreds;
  branchPrefix: string;
};

export async function up(opts: UpOpts = {}) {
  const shouldMigrate = opts.migrate ?? true;
  // Type/swagger regen depends on a freshly-migrated schema. If migrations
  // were skipped, schema is unchanged — skip regen too.
  const shouldRegen = shouldMigrate && (opts.regen ?? true);
  const shouldBorrow = opts.borrow === true;
  // Services-only mode: boot compose stack + portless aliases (api/studio/
  // mail/inngest URLs still useful), skip spawnApps + auto-`down` on Ctrl+C.
  // Triggered by --no-apps OR by deselecting everything in the picker.
  const appsRequested = opts.apps ?? true;

  // Load .env early so CARBON_PORTLESS (and other flags) can be set there
  // rather than requiring a shell export. .env.local takes precedence.
  const root = await getWorktreeRoot();
  loadDotenv({ path: join(root, ".env.local"), override: false });
  loadDotenv({ path: join(root, ".env"), override: false });

  // --no-portless flag or CARBON_PORTLESS=0 to use http://localhost:PORT URLs
  // and skip the portless proxy setup (useful when the .dev TLD cert is not
  // trusted). The flag takes precedence over the env var.
  const portless =
    opts.portless !== undefined
      ? opts.portless
      : process.env.CARBON_PORTLESS !== "0";

  intro("Carbon · dev up");

  if (portless) {
    await ensurePortlessInstalled();
    await ensureProxyPrivileges();
  } else {
    log.info("portless disabled (CARBON_PORTLESS=0) — using localhost URLs");
  }

  const selectedApps = appsRequested ? await pickApps() : [];
  const slug = resolveSlug(root);

  // Resolve borrowed slot before ensureSlugAvailable (borrowing doesn't start
  // own containers so the slug conflict check is irrelevant).
  let borrowedEntry:
    | { ports: PortMap; redisDb: number; jwt: JwtCreds }
    | undefined;
  if (shouldBorrow) {
    const borrowSlug = await pickBorrowSlug(slug);
    const entry = getSlot(borrowSlug);
    if (!entry)
      throw new Error(
        `No slot found for worktree "${borrowSlug}" in ~/.carbon/dev-ports.json`
      );
    borrowedEntry = entry;
    log.info(`borrowing containers from: ${borrowSlug}`);
  } else {
    await ensureSlugAvailable(slug, root);
  }

  persistSlug(root, slug);
  log.info(`worktree: ${slug}  (project ${projectName(slug)})`);

  await refreshStaleCopyFiles(root);
  await ensureDepsInstalled(root);

  const ctx = await provisionSlot(root, slug, portless, borrowedEntry);
  if (borrowedEntry) {
    await waitForServices(ctx);
  } else {
    await pullImages(ctx, { force: opts.pull === true });
    await bootDockerStack(ctx);
    await waitForServices(ctx);
  }
  await runDatabaseMigrations(ctx, { shouldMigrate, shouldRegen });
  await seedSmokeTestUser(ctx);
  if (portless) {
    await setupPortless(ctx, selectedApps);
    await ensureHostsFile();
  }

  if (process.env.CARBON_EDITION === "cloud") {
    spawnStripeListener(root);
    log.info("stripe listener spawned (CARBON_EDITION=cloud)");
  }

  box(
    summaryLines(
      ctx.ports,
      selectedApps,
      portless ? ctx.branchPrefix : undefined
    ).join("\n"),
    `Carbon dev — ${slug}`
  );

  if (selectedApps.length === 0) {
    outro("services up (run `crbn down` to stop)");
    return;
  }
  outro("apps starting (Ctrl+C to stop)");
  await runAppsThenTeardown(root, selectedApps, ctx.ports, portless);
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

// Auto-heal stale `.env` (and other package.json#crbn.copy entries) from main
// checkout. `crbn checkout <existing-branch>` skips do_post_create → existing
// worktrees drift from main when new env vars land. Mtime-gated, so unchanged
// files are untouched and local edits made *after* main's last change are
// preserved.
async function refreshStaleCopyFiles(root: string) {
  const refreshed = await syncStaleCopyFiles(root);
  if (refreshed.length > 0) {
    log.info(
      `refreshed ${refreshed.join(", ")} from main checkout (stale vs main)`
    );
  }
}

// Outside `tasks` so pnpm progress streams directly when install runs.
async function ensureDepsInstalled(root: string) {
  const ran = await installDeps(root);
  if (ran) log.step("pnpm install");
  else log.info("pnpm install skipped (lockfile in sync)");
}

async function provisionSlot(
  root: string,
  slug: string,
  portless: boolean,
  borrowedEntry?: { ports: PortMap; redisDb: number; jwt: JwtCreds }
): Promise<Ctx> {
  let ctx!: Ctx;
  await tasks([
    {
      title: borrowedEntry ? "Configure (borrowed slot)" : "Configure portless",
      task: async () => {
        // Always resolve own slot so PORT_ERP/PORT_MES are claimed for this
        // worktree and won't collide with the borrowed stack's running dev servers.
        const ownSlot = await resolveSlot(slug, root);
        // Pin well-known ports in localhost mode so URLs are predictable and
        // OAuth redirect URIs can be registered once in Google/Azure console.
        if (!portless && !borrowedEntry) {
          ownSlot.ports.PORT_API = 54321;
          ownSlot.ports.PORT_ERP = 3000;
          ownSlot.ports.PORT_MES = 3001;
        }
        const slot = borrowedEntry
          ? {
              // Backend ports (DB, API, Studio, Inbucket, Inngest) come from the
              // borrowed stack — apps talk to those running containers.
              // App ports (ERP, MES) come from our own slot — dev servers bind here,
              // so they don't conflict with the borrowed stack's dev servers.
              ports: {
                ...borrowedEntry.ports,
                PORT_ERP: ownSlot.ports.PORT_ERP,
                PORT_MES: ownSlot.ports.PORT_MES
              } as PortMap,
              redisDb: borrowedEntry.redisDb,
              jwt: borrowedEntry.jwt
            }
          : ownSlot;
        const branch = await currentBranch(root);
        const branchPrefix = branchToPrefix(branch, slug);

        ctx = { root, slug, branchPrefix, ...slot };

        writeEnv(root, renderEnv({ slug, portless, branchPrefix, ...slot }));
        syncAppPortlessConfigs(root);
        // Use override: true so freshly written .env.local values replace any
        // stale values already in process.env from the initial load at startup.
        loadDotenv({ path: join(root, ".env.local"), override: true });
        loadDotenv({ path: join(root, ".env"), override: false });
        return borrowedEntry
          ? `borrowed backend ports, own app ports (ERP :${slot.ports.PORT_ERP} MES :${slot.ports.PORT_MES}), redis db ${slot.redisDb}`
          : portless
            ? `prefix "${branchPrefix}", redis db ${slot.redisDb}`
            : `localhost mode, redis db ${slot.redisDb}`;
      }
    },
    {
      title: "Render .env.local & sync symlinks",
      task: async () => {
        await syncEnvSymlinks(root);
        return "env files synced";
      }
    },
    {
      title: "Boot shared redis",
      task: async () => {
        await bootSharedRedis(root);
        return `shared redis on :${SHARED_REDIS_PORT} (index ${ctx.redisDb})`;
      }
    }
  ]);
  return ctx;
}

// Pull images outside `tasks()` so we can use clack's progress bar (one
// tick per `<service> Pulled` event). Spinner subtitle inside `tasks()`
// can't render a bar, only a single line of text.
async function pullImages(ctx: Ctx, opts: { force: boolean }) {
  if (!opts.force) {
    const refs = await devComposeImageRefs(ctx.root, ctx.slug);
    if (refs && (await allImagesPresentLocally(refs))) {
      log.info("docker images already present — skipping compose pull");
      return;
    }
  }

  const services = await listComposeServices(ctx.root, ctx.slug);
  const max = Math.max(services.length, 1);
  const bar = progress({ style: "heavy", max });
  bar.start("Pulling docker images");
  try {
    await pullStack(ctx.root, ctx.slug, (line) => {
      bar.message(line.slice(0, 80));
      if (/ Pulled$/.test(line)) bar.advance(1);
    });
    bar.stop("images up to date");
  } catch (err) {
    bar.stop("pull failed");
    throw err;
  }
}

async function bootDockerStack(ctx: Ctx) {
  await tasks([
    {
      title: "Boot docker compose stack",
      task: async (msg) => {
        msg("starting 12 services");
        await bootStack(ctx.root, ctx.slug);
        return "containers up";
      }
    }
  ]);
}

// Wait for services via clack progress bar:
//   3× TCP ports → +1 postgres ready → +1 storage.buckets = 5 ticks.
// `waitForStorageReady` owns the storage heal path internally.
async function waitForServices(ctx: Ctx) {
  const bar = progress({ style: "heavy", max: 5 });
  bar.start("Waiting for services");
  try {
    await waitForTcp(
      [
        `tcp:${ctx.ports.PORT_DB}`,
        `tcp:${ctx.ports.PORT_API}`,
        `tcp:${ctx.ports.PORT_INNGEST}`
      ],
      { onProgress: (line) => bar.advance(1, line.slice(0, 80)) }
    );

    bar.message("waiting for postgres to accept queries");
    await waitForPostgres(ctx.ports.PORT_DB);
    bar.advance(1, "postgres ready");

    await waitForStorageReady(ctx.ports.PORT_DB, {
      onProgress: (line) => bar.message(line.slice(0, 80)),
      onHeal: async () => {
        bar.message("storage stuck — re-applying init.sql");
        await applyBootstrapSql(ctx.root, ctx.ports.PORT_DB);
        bar.message("restarting storage / gotrue / postgrest");
        await restartServices(ctx.root, ctx.slug, [
          "storage",
          "gotrue",
          "postgrest"
        ]);
      },
      onTimeout: () => dumpStorageDiagnostics(ctx)
    });
    bar.advance(1, "storage.buckets ready");
    bar.stop("all services responding");
  } catch (err) {
    bar.stop("services not ready");
    throw err;
  }
}

async function runDatabaseMigrations(
  ctx: Ctx,
  cfg: { shouldMigrate: boolean; shouldRegen: boolean }
) {
  let migrationsApplied = false;
  await tasks([
    cfg.shouldMigrate
      ? {
          title: "Apply database migrations",
          task: async () => {
            const r = await applyMigrations(ctx.root, ctx.ports.PORT_DB);
            migrationsApplied = r.applied;
            return r.applied
              ? "migrations applied"
              : "schema already up to date";
          }
        }
      : {
          title: "Skip database migrations (--no-migrate)",
          task: async () => "skipped"
        },
    ...(cfg.shouldRegen
      ? [
          {
            title: "Regenerate types & swagger",
            task: async () => {
              if (!migrationsApplied) return "skipped (no new migrations)";
              await execa("pnpm", ["db:types"], { cwd: ctx.root });
              await execa("pnpm", ["generate:swagger"], { cwd: ctx.root });
              return "types + swagger refreshed";
            }
          }
        ]
      : [])
  ]);
}

async function seedSmokeTestUser(ctx: Ctx) {
  await tasks([
    {
      title: "Seed smoke-test user (test@carbon.ms)",
      task: async () => {
        const r = await ensureSmokeTestUser(
          ctx.root,
          ctx.ports.PORT_DB,
          ctx.ports.PORT_API
        );
        return r.seeded ? "user created" : "already exists";
      }
    }
  ]);
}

async function setupPortless(ctx: Ctx, _selectedApps: AppId[]) {
  await tasks([
    {
      title: "Prune stale portless routes",
      task: async () => {
        await pruneStaleRoutes();
        return "orphans cleaned";
      }
    },
    {
      title: "Start portless proxy",
      task: async (msg) => {
        startProxyDaemon(ctx.root);
        msg("waiting for proxy on :443");
        await waitForProxyReady();
        return "proxy listening";
      }
    },
    {
      title: "Register service aliases",
      task: async () => {
        const count = await registerAliases(
          ctx.root,
          ctx.branchPrefix,
          ctx.ports
        );
        return `${count} aliases registered`;
      }
    }
  ]);
}

// Verify /etc/hosts has all expected entries. Root proxy auto-syncs via
// fs.watch on routes.json, but there's a race between alias registration
// and the watcher firing. Poll briefly, then fall back to sudo sync.
async function ensureHostsFile() {
  if (proxyRunsAsRoot()) {
    // Give the root daemon a moment to pick up new routes.
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      if (hostsFileInSync()) {
        log.info("/etc/hosts verified in sync");
        return;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    log.warn("/etc/hosts not in sync after 3s — falling back to manual sync");
  } else if (hostsFileInSync()) {
    log.info("/etc/hosts already in sync — skipping sudo");
    return;
  }
  log.step("sudo portless hosts sync");
  await syncHostsFile();
}

async function runAppsThenTeardown(
  root: string,
  selectedApps: AppId[],
  ports: PortMap,
  portless: boolean
) {
  await spawnApps({ root, apps: selectedApps, ports, portless });

  // Apps exit on Ctrl+C; auto-`down` so compose stack isn't orphaned.
  // Swallow further signals so a second Ctrl+C during teardown doesn't
  // exit 130 mid-`docker compose stop`.
  const detach = onShutdown(() => {
    process.stderr.write("\nfinishing teardown — please wait\n");
  });
  try {
    // silent: post-SIGINT stdin raw-mode triggers EIO in clack's spinner.
    await down({ silent: true });
  } finally {
    detach();
  }
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

async function dumpStorageDiagnostics(ctx: Ctx) {
  const containers = await listContainers(ctx.root, ctx.slug);
  const out: string[] = ["", "--- container state ---"];
  for (const name of ["postgres", "storage"]) {
    out.push(formatContainerLine(name, containers));
  }
  out.push("", "--- storage logs (last 50) ---");
  out.push(await tailServiceLogs(ctx.root, ctx.slug, "storage", 50));
  out.push("", "--- postgres logs (last 20) ---");
  out.push(await tailServiceLogs(ctx.root, ctx.slug, "postgres", 20));
  out.push("");
  process.stderr.write(out.join("\n") + "\n");
}

function formatContainerLine(name: string, containers: Container[]): string {
  const c = containers.find((x) => x.Service === name);
  if (!c) return `${name.padEnd(10)} (not found)`;
  return `${name.padEnd(10)} state=${c.State} health=${c.Health ?? "n/a"}  ${c.Status}`;
}
