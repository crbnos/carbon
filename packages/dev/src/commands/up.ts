// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { writeFileSync } from "node:fs";
import { box, intro, log, outro } from "@clack/prompts";
import { config as loadDotenv } from "dotenv";
import { type ExecaChildProcess, execa } from "execa";
import { join } from "pathe";
import pc from "picocolors";
import { APP_CHOICES, type AppId } from "../constants.js";
import { renderEnv, syncAppPortlessConfigs, writeEnv } from "../env.js";
import { currentBranch } from "../git.js";
import { onShutdown, tryConnect } from "../helpers.js";
import { pickApps, pickBorrowSlug } from "../prompts.js";
import {
  assemblerDepsBuilt,
  assertAssemblerDepsBuilt,
  installDeps,
  installSkills,
  spawnApps,
  spawnAssembler,
  spawnEmailPreview,
  spawnStripeListener,
  stopAuxApps,
  syncEnvSymlinks,
  whenAuxAppExits
} from "../services/apps.js";
import {
  allImagesPresentLocally,
  bootSharedRedis,
  bootStack,
  type Container,
  devComposeImageRefs,
  ensureDockerRunning,
  listComposeServices,
  listContainers,
  pullStack,
  restartServices,
  type StackSize,
  sleepStack,
  tailServiceLogs
} from "../services/compose.js";
import {
  activityFile,
  stackStateDir,
  startWaker,
  watchIdle
} from "../services/hibernate.js";
import {
  applyBootstrapSql,
  applyMigrations,
  ensureConfigRow,
  ensureSmokeTestUser,
  syncAuthz,
  waitForApi,
  waitForPostgres,
  waitForServiceSchemas,
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
import { progress, summaryLines, tasks } from "../ui.js";
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
  /** When true, launch all apps without the interactive picker. */
  all?: boolean;
  /** When true, always `docker compose pull` even if images exist locally. */
  pull?: boolean;
  /** When true, show a picker to borrow another worktree's running containers. */
  borrow?: boolean;
  /** When false, skip portless proxy and use localhost URLs. */
  portless?: boolean;
  /**
   * Boot apps, wait until reachable, run this shell command, then tear the
   * stack down. Scopes the stack's lifetime to the command (headless/CI use):
   * `crbn up` exits with the command's exit code. No detached daemon to reap.
   */
  run?: string;
  /** With --run, also remove Docker volumes on teardown (headless: don't leak
   *  data volumes across dispatches on a long-lived box). */
  volumes?: boolean;
  /**
   * Skip non-essential services (Studio, Postgres-Meta, Inbucket) to reduce
   * memory footprint. Useful for headless/CI builds on memory-constrained
   * hosts where the Supabase dashboard and email testing UI aren't needed.
   */
  minimal?: boolean;
  /** Also start Studio, Postgres-Meta and the edge runtime. */
  full?: boolean;
  /** Stop the containers while ERP/MES get no traffic (default true). */
  hibernate?: boolean;
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
  const minimal = opts.minimal ?? false;
  const size = { minimal, full: !minimal && opts.full === true };
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

  intro(minimal ? "Carbon · dev up (minimal)" : "Carbon · dev up");
  // Fail fast with a clear message instead of a cryptic daemon error deep in
  // the boot (after prompts + sudo).
  await ensureDockerRunning();

  // During the long pre-apps phase (image pulls, migrations, sudo prompts) a
  // Ctrl+C would otherwise kill crbn and orphan half-booted containers. Tear
  // them down on interrupt; detached once apps take over teardown (below).
  let stripeChild: ExecaChildProcess | undefined;
  let interrupted = false;
  const detachEarly = onShutdown(() => {
    if (interrupted) return;
    interrupted = true;
    process.stderr.write("\ninterrupted — stopping partial stack…\n");
    killStripe(stripeChild);
    void down({ silent: true }).finally(() => process.exit(130));
  });

  if (portless) {
    await ensurePortlessInstalled();
    await ensureProxyPrivileges();
  } else {
    log.info("portless disabled (CARBON_PORTLESS=0) — using localhost URLs");
  }

  const allApps = opts.all === true;
  const selectedApps = appsRequested
    ? allApps
      ? // --all includes the assembler, but only when its one-time native OCCT
        // build exists — otherwise skip it (with a note) rather than hard-failing
        // the whole --all on a machine that hasn't built it. An explicit pick of
        // the assembler still fails fast below.
        APP_CHOICES.map((c) => c.value).filter((v) => {
          if (v !== "assembler") return true;
          if (assemblerDepsBuilt()) return true;
          log.warn(
            "assembler skipped from --all: its OCCT build isn't present " +
              "(apps/assembler/scripts/build-occt.sh)"
          );
          return false;
        })
      : await pickApps()
    : [];
  // Fail before booting anything heavy (docker, migrations) if the assembler is
  // selected without its one-time OCCT build.
  if (selectedApps.includes("assembler")) assertAssemblerDepsBuilt();
  const slug = resolveSlug(root);

  // Resolve borrowed slot before ensureSlugAvailable (borrowing doesn't start
  // own containers so the slug conflict check is irrelevant).
  let borrowedEntry:
    | { ports: PortMap; redisDb: number; jwt: JwtCreds }
    | undefined;
  let borrowSlug: string | undefined;
  if (shouldBorrow) {
    borrowSlug = await pickBorrowSlug(slug);
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
  await ensureSkillsInstalled(root);

  const ctx = await provisionSlot(
    root,
    slug,
    portless,
    selectedApps.includes("assembler"),
    borrowedEntry
  );
  if (borrowedEntry) {
    await waitForServices(ctx);
  } else {
    await pullImages(ctx, { force: opts.pull === true, size });
    await bootDockerStack(ctx, size);
    await waitForServices(ctx);
  }
  await runDatabaseMigrations(ctx, { shouldMigrate, shouldRegen });
  // Skip when migrations are skipped: the `user` table may not exist yet, and
  // seeding would fail with `relation "user" does not exist`.
  if (shouldMigrate) await seedSmokeTestUser(ctx);
  if (portless) {
    await setupPortless(ctx, selectedApps);
    await ensureHostsFile();
  }

  if (process.env.CARBON_EDITION === "cloud") {
    stripeChild = spawnStripeListener(root);
    log.info("stripe listener spawned (CARBON_EDITION=cloud)");
  }

  if (selectedApps.includes("assembler")) {
    spawnAssembler({ root, ports: ctx.ports });
  }

  if (selectedApps.includes("email")) {
    spawnEmailPreview({ root, ports: ctx.ports });
  }

  const summary = summaryLines(
    ctx.ports,
    selectedApps,
    portless ? ctx.branchPrefix : undefined,
    size.full
  );
  // `box()` derives its padding from `process.stdout.columns`; some
  // non-interactive terminals (e.g. Conductor's run pane) report a width of 0,
  // which makes @clack compute a negative `String.repeat` count and throw. This
  // is only the cosmetic end-of-boot summary and it runs *before* the apps are
  // spawned, so never let it abort startup — fall back to plain lines if the box
  // can't be drawn.
  try {
    box(summary.join("\n"), `Carbon dev — ${slug}`);
  } catch {
    log.info(`Carbon dev — ${slug}`);
    for (const line of summary) log.message(line);
  }

  // Startup done — hand teardown ownership to the app supervisor (or, for
  // services-only, to a later manual `crbn down`).
  detachEarly();

  // --run: scope the stack's lifetime to a command (headless/CI). Boot apps,
  // wait until reachable, run it, then tear everything down. No daemon to reap.
  if (opts.run !== undefined) {
    outro("apps starting, then running command");
    await runAppsThenCommand(
      root,
      selectedApps,
      ctx.ports,
      portless,
      opts.run,
      stripeChild,
      opts.volumes ?? false
    );
    return;
  }

  if (selectedApps.length === 0) {
    // Services-only: the stack stays up after crbn exits, so let the stripe
    // listener outlive us too (apps mode kills it on teardown instead).
    stripeChild?.unref();
    outro("services up (run `crbn down` to stop)");
    return;
  }
  outro("apps starting (Ctrl+C to stop)");

  // The dev servers report traffic for the stack they talk to — the borrowed
  // one under --borrow, whose own `crbn up` does the hibernating.
  const stateDir = stackStateDir(borrowSlug ?? slug);
  process.env.CRBN_STACK_STATE = stateDir;
  const idleMinutes = Number(process.env.CRBN_IDLE_MINUTES ?? 30);
  const hibernates =
    opts.hibernate !== false &&
    !borrowSlug &&
    idleMinutes > 0 &&
    reactRouterApps(selectedApps).length > 0;
  // Deep sleep parks the dev servers: the watcher aborts them, listens on
  // their ports itself, and on the next request starts the containers and lets
  // the app loop below spawn them again.
  const deepMinutes = Number(process.env.CRBN_APPS_IDLE_MINUTES ?? 120);
  const appPorts = reactRouterApps(selectedApps).flatMap((id) => {
    const key = APP_PORT_KEY[id];
    return key ? [ctx.ports[key]] : [];
  });
  const parking: AppParking = { parked: false };
  let wakers: Array<() => Promise<void>> = [];
  let tearingDown = false;
  const wakeContainers = async () => {
    await bootStack(root, slug, size);
    await waitForPostgres(ctx.ports.PORT_DB);
    await waitForApi(ctx.ports.PORT_API, ctx.jwt.anonKey);
  };
  const stopWatching = hibernates
    ? watchIdle({
        dir: stateDir,
        idleMs: idleMinutes * 60_000,
        deepMs: deepMinutes * 60_000,
        sleep: () => sleepStack(root, slug),
        deepen: async () => {
          parking.parked = true;
          parking.stop?.abort();
          await parking.exited;
          wakers = appPorts.map((port) =>
            startWaker(port, () => writeFileSync(activityFile(stateDir), ""))
          );
        },
        wake: async (from) => {
          try {
            await wakeContainers();
          } finally {
            // Whatever happened to the containers, never leave the apps
            // parked behind a listener that can no longer wake them.
            if (from === "deep") {
              await Promise.all(wakers.map((stop) => stop()));
              wakers = [];
              parking.parked = false;
              parking.resume?.();
              // Awake means the dev servers are listening again: until then
              // no request can reach them, and the idle clock must not run.
              // Unless the stack is being torn down — nothing will listen.
              const deadline = Date.now() + 180_000;
              while (!tearingDown && Date.now() < deadline) {
                const open = await Promise.all(
                  appPorts.map((port) => tryConnect("127.0.0.1", port, 500))
                );
                if (open.every(Boolean)) break;
                await new Promise((resolve) => setTimeout(resolve, 500));
              }
            }
          }
        },
        log: (line) => process.stderr.write(`${pc.cyan("•")} ${line}\n`)
      })
    : undefined;
  // Before `down()`, not after it: a request (the waking page polls every
  // 1.5 s) can start a wake at any moment, and one that ran during or after
  // the teardown would leave the containers up with no `crbn up` owning them.
  const stopHibernation = async () => {
    tearingDown = true;
    await stopWatching?.();
    await Promise.all(wakers.map((stop) => stop()));
    wakers = [];
  };
  try {
    await runAppsThenTeardown(
      root,
      selectedApps,
      ctx.ports,
      portless,
      stripeChild,
      parking,
      stopHibernation
    );
  } finally {
    await stopHibernation();
  }
}

// Shared between the idle watcher and the app loop. `parked` means the dev
// servers were stopped on purpose and will be started again.
type AppParking = {
  parked: boolean;
  stop?: AbortController;
  exited?: Promise<void>;
  resume?: () => void;
};

// Kill the detached stripe listener's whole process group (apps-mode teardown).
function killStripe(child?: ExecaChildProcess) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
      // biome-ignore lint/suspicious/noEmptyBlockStatements: best-effort kill
    } catch {}
  }
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

// Keep the .claude/.codex skill+rule symlinks in sync on every boot. They're
// gitignored (absent in fresh worktrees) and `prepare` only runs when pnpm
// install runs, so this is the reliable place to guarantee they exist.
async function ensureSkillsInstalled(root: string) {
  const ok = await installSkills(root);
  if (ok) log.step("skills + rules linked");
  else log.info("install-skills skipped");
}

async function provisionSlot(
  root: string,
  slug: string,
  portless: boolean,
  includeAssembler: boolean,
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
                PORT_MES: ownSlot.ports.PORT_MES,
                PORT_EMAIL: ownSlot.ports.PORT_EMAIL
              } as PortMap,
              redisDb: borrowedEntry.redisDb,
              jwt: borrowedEntry.jwt
            }
          : ownSlot;
        const branch = await currentBranch(root);
        const branchPrefix = branchToPrefix(branch, slug);

        ctx = { root, slug, branchPrefix, ...slot };

        writeEnv(
          root,
          renderEnv({
            slug,
            portless,
            branchPrefix,
            includeAssembler,
            ...slot
          })
        );
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
        await bootSharedRedis();
        return `shared redis on :${SHARED_REDIS_PORT} (index ${ctx.redisDb})`;
      }
    }
  ]);
  return ctx;
}

// Pull images outside `tasks()` so we can use clack's progress bar (one
// tick per `<service> Pulled` event). Spinner subtitle inside `tasks()`
// can't render a bar, only a single line of text.
async function pullImages(ctx: Ctx, opts: { force: boolean; size: StackSize }) {
  if (!opts.force) {
    const refs = await devComposeImageRefs(ctx.root, ctx.slug, opts.size);
    if (refs && (await allImagesPresentLocally(refs))) {
      log.info("docker images already present — skipping compose pull");
      return;
    }
  }

  const services = await listComposeServices(ctx.root, ctx.slug, opts.size);
  const max = Math.max(services.length, 1);
  const bar = progress({ style: "heavy", max });
  bar.start(
    opts.size.minimal
      ? "Pulling docker images (minimal)"
      : "Pulling docker images"
  );
  try {
    await pullStack(
      ctx.root,
      ctx.slug,
      (line) => {
        bar.message(line.slice(0, 80));
        if (/ Pulled$/.test(line)) bar.advance(1);
      },
      opts.size
    );
    bar.stop("images up to date");
  } catch (err) {
    bar.stop("pull failed");
    throw err;
  }
}

async function bootDockerStack(ctx: Ctx, size: StackSize) {
  const label = size.minimal
    ? "Boot docker compose stack (minimal — no inbucket)"
    : size.full
      ? "Boot docker compose stack (full — with studio/meta/edge-runtime/imgproxy)"
      : "Boot docker compose stack";
  await tasks([
    {
      title: label,
      task: async () => {
        await bootStack(ctx.root, ctx.slug, size);
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
    bar.message("waiting for auth / realtime schemas");
    await waitForServiceSchemas(ctx.ports.PORT_DB);
    bar.advance(1, "service schemas ready");
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
    // Gated on shouldMigrate: with --no-migrate on a fresh volume the
    // "config" table doesn't exist yet and the upsert would abort the boot.
    ...(cfg.shouldMigrate
      ? [
          {
            title: "Seed pg_net config row",
            task: async () => {
              await ensureConfigRow(ctx.ports.PORT_DB, ctx.jwt.anonKey);
              return "config row upserted";
            }
          }
        ]
      : []),
    ...(cfg.shouldRegen
      ? [
          {
            title: "Regenerate types & swagger",
            task: async () => {
              // Always regenerate types: the on-disk types must match the DB
              // schema, which can be out of sync even when no NEW migration ran
              // this boot — the schema is already applied to this worktree's DB
              // after a branch switch, stash-pop, or reverted generated files.
              // Gating on `migrationsApplied` left stale types in those cases.
              await execa("pnpm", ["db:types"], { cwd: ctx.root });
              // Swagger only changes with the schema and is heavier, so keep it
              // gated on a migration having actually applied this boot.
              if (migrationsApplied) {
                await execa("pnpm", ["generate:swagger"], { cwd: ctx.root });
                return "types + swagger refreshed";
              }
              return "types refreshed";
            }
          }
        ]
      : []),
    ...(cfg.shouldMigrate
      ? [
          {
            title: "Sync RLS policies with the authz manifest",
            task: () => syncAuthz(ctx.root, ctx.ports.PORT_DB)
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
        const { registered, total } = await registerAliases(
          ctx.root,
          ctx.branchPrefix,
          ctx.ports
        );
        return registered === total
          ? `${registered} aliases registered`
          : `${registered}/${total} aliases registered (${total - registered} failed)`;
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

function reactRouterApps(selectedApps: AppId[]): AppId[] {
  return selectedApps.filter((id) => id !== "assembler" && id !== "email");
}

async function runAppsThenTeardown(
  root: string,
  selectedApps: AppId[],
  ports: PortMap,
  portless: boolean,
  stripeChild?: ExecaChildProcess,
  parking: AppParking = { parked: false },
  beforeTeardown?: () => Promise<void>
) {
  const apps = reactRouterApps(selectedApps);
  let detachParked: (() => void) | undefined;
  if (apps.length === 0) {
    await Promise.race([
      new Promise<void>((resolve) => {
        onShutdown(() => resolve());
      }),
      whenAuxAppExits()
    ]);
  } else {
    for (;;) {
      parking.stop = new AbortController();
      parking.exited = spawnApps({
        root,
        apps,
        ports,
        portless,
        signal: parking.stop.signal
      });
      await parking.exited;
      // Exited on their own or on Ctrl+C: tear down. Parked: wait for the
      // wake (or a Ctrl+C, which spawnApps is no longer listening for).
      if (!parking.parked) break;
      const interrupted = await new Promise<boolean>((resolve) => {
        // The listener is NOT removed from inside the signal: execa's cleanup
        // hook re-raises a signal it finds nobody else listening for, and a
        // wake has a docker child running. It stays until the teardown
        // listener below is in place.
        detachParked = onShutdown(() => resolve(true));
        parking.resume = () => {
          detachParked?.();
          detachParked = undefined;
          resolve(false);
        };
      });
      if (interrupted) break;
    }
  }

  // Apps exit on Ctrl+C; auto-`down` so compose stack isn't orphaned.
  // Swallow further signals so a second Ctrl+C during teardown doesn't
  // exit 130 mid-`docker compose stop`.
  const detach = onShutdown(() => {
    process.stderr.write("\nfinishing teardown — please wait\n");
  });
  detachParked?.();
  try {
    await beforeTeardown?.();
    // Kill the stripe listener too — it's detached and would otherwise survive.
    killStripe(stripeChild);
    // silent: post-SIGINT stdin raw-mode triggers EIO in clack's spinner.
    await down({ silent: true });
  } finally {
    detach();
  }
}

// Port each app's dev server binds (mirrors apps.ts APP_PORT_KEYS).
const APP_PORT_KEY: Partial<Record<AppId, keyof PortMap>> = {
  erp: "PORT_ERP",
  mes: "PORT_MES"
};

/** A single readiness probe — any HTTP status means the dev server is up. */
async function appResponds(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      signal: AbortSignal.timeout(4000)
    });
    return res.status > 0;
  } catch {
    return false;
  }
}

/** Poll each selected app's port concurrently until all serve (or deadline). */
async function waitForApps(
  selectedApps: AppId[],
  ports: PortMap,
  timeoutMs = 180_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  await Promise.all(
    selectedApps.map(async (id) => {
      const key = APP_PORT_KEY[id];
      const port = key ? ports[key] : undefined;
      if (port === undefined) return;
      let up = false;
      while (Date.now() < deadline) {
        if (await appResponds(port)) {
          up = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (up) log.info(`${id} reachable on :${port}`);
      else log.warn(`${id} not reachable on :${port} — running command anyway`);
    })
  );
}

/**
 * Boot apps in the background, wait until reachable, run `command`, then tear
 * the whole stack down. The stack's lifetime is exactly the command's — the
 * headless/CI counterpart to the interactive Ctrl+C flow. Reuses the
 * AbortSignal teardown `spawnApps` already exposes, so there's no detached
 * daemon to track or reap. `crbn up` exits with the command's exit code.
 */
async function runAppsThenCommand(
  root: string,
  selectedApps: AppId[],
  ports: PortMap,
  portless: boolean,
  command: string,
  stripeChild?: ExecaChildProcess,
  cleanVolumes = false
) {
  const controller = new AbortController();
  const appsDone = spawnApps({
    root,
    apps: reactRouterApps(selectedApps),
    ports,
    portless,
    signal: controller.signal
    // biome-ignore lint/suspicious/noEmptyBlockStatements: supervisor errors surface via teardown
  }).catch(() => {});
  const detach = onShutdown(() => controller.abort());

  let exitCode = 0;
  try {
    await waitForApps(selectedApps, ports);
    log.step(`running: ${command}`);
    const res = await execa(command, {
      cwd: root,
      shell: true,
      stdio: "inherit",
      reject: false
    });
    exitCode = res.exitCode ?? 0;
  } finally {
    controller.abort(); // stop the app supervisors
    await appsDone;
    stopAuxApps();
    killStripe(stripeChild);
    await down({ silent: true, volumes: cleanVolumes });
    detach();
  }
  process.exitCode = exitCode;
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
