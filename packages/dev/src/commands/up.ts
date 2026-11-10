// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { rmSync } from "node:fs";
import { box, intro, log, outro } from "@clack/prompts";
import { execa } from "execa";
import pc from "picocolors";
import { asleepFile } from "../../stack-state.js";
import {
  APPS,
  type AppId,
  LOCALHOST_PORTS,
  ROUTES,
  reactRouterApps,
  routeAlias
} from "../constants.js";
import { syncStaleCopyFiles } from "../copy-files.js";
import { loadEnvFiles, writeStackEnv } from "../env.js";
import { currentBranch, getWorktreeRoot } from "../git.js";
import { httpResponds, onShutdown, waitUntil } from "../helpers.js";
import {
  ensurePortlessInstalled,
  ensureProxyPrivileges,
  syncHostsFile
} from "../portless-setup.js";
import { pickApps, pickBorrowSlug } from "../prompts.js";
import {
  assemblerMissingPrerequisite,
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
  bootSharedForIsolated,
  bootSharedServices,
  bootStack,
  type Container,
  devComposeImageRefs,
  ensureDockerRunning,
  ensureSlugAvailable,
  listComposeServices,
  listContainers,
  listSharedContainers,
  pullStack,
  removeServices,
  restartServices,
  type StackSize,
  sleepStack,
  tailServiceLogs,
  tailSharedLogs
} from "../services/compose.js";
import {
  APPS_IDLE_MINUTES,
  holdRoutes,
  IDLE_MINUTES,
  superviseIdle
} from "../services/hibernate.js";
import {
  applyBootstrapSql,
  databaseTasks,
  ensureSmokeTestUser,
  waitForApi,
  waitForPostgres,
  waitForServiceSchemas,
  waitForStorageReady,
  waitForTcp
} from "../services/migrations.js";
import {
  branchToPrefix,
  hostsFileInSync,
  proxyRunsAsRoot,
  pruneStaleRoutes,
  registerAliases,
  startProxyDaemon,
  waitForProxyReady
} from "../services/portless.js";
import { provisionWorktreeData } from "../services/shared-db.js";
import { type Stack, stackAt } from "../stack.js";
import { teardown } from "../teardown.js";
import {
  SHARED_DB_PORT,
  SHARED_INBUCKET_PORT,
  SHARED_POOLER_PORT,
  SHARED_REDIS_PORT,
  type StackMode,
  stackHosts
} from "../topology.js";
import { progress, summaryLines, tasks } from "../ui.js";
import {
  getSlot,
  type JwtCreds,
  type PortMap,
  persistSlug,
  resolveSlot,
  resolveSlug,
  type Slot,
  stackDatabase,
  stackPorts,
  writeStackMode
} from "../worktree.js";

type UpOpts = {
  migrate?: boolean;
  regen?: boolean;
  apps?: boolean;
  /** Launch all apps without the interactive picker. */
  all?: boolean;
  /** Always `docker compose pull`, even when the images exist locally. */
  pull?: boolean;
  /** Pick another worktree's running containers to use. */
  borrow?: boolean;
  /** false: no portless proxy, localhost URLs. Unset: CARBON_PORTLESS. */
  portless?: boolean;
  /**
   * Boot apps, wait until reachable, run this shell command, then tear the
   * stack down: the stack lives exactly as long as the command (headless/CI),
   * and `crbn up` exits with its exit code.
   */
  run?: string;
  /** With --run, also remove the volumes on teardown, so a long-lived box
   *  does not collect them across dispatches. */
  volumes?: boolean;
  /** Skip Studio, Postgres-Meta and Inbucket (memory-constrained CI). */
  minimal?: boolean;
  /** Also start Studio, Postgres-Meta and a private edge runtime, which the
   *  gateway uses instead of the shared one (for editing functions). */
  full?: boolean;
  /** Stop the containers while ERP/MES get no traffic (default true). */
  hibernate?: boolean;
  /**
   * Run a private Postgres, PgBouncer, Storage, imgproxy and Inbucket inside
   * this worktree's project instead of the shared containers — for a branch
   * that changes one of their images.
   */
  isolated?: boolean;
};

/** The stack this boot runs: under --borrow, the borrowed stack's
 *  containers with this worktree's own dev-server ports. */
type Ctx = Stack & {
  ports: PortMap;
  db: NonNullable<Stack["db"]>;
  slot: Slot;
  jwt: JwtCreds;
  /** The portless host prefix; null in localhost mode. */
  prefix: string | null;
  /** This boot cloned the worktree database: it holds no service schemas. */
  freshDatabase: boolean;
};

export async function up(opts: UpOpts = {}) {
  const shouldMigrate = opts.migrate ?? true;
  // Types and swagger follow the migrated schema.
  const shouldRegen = shouldMigrate && (opts.regen ?? true);
  const minimal = opts.minimal ?? false;

  const root = await getWorktreeRoot();
  // Settings like CARBON_PORTLESS may live in .env.
  loadEnvFiles(root, { shellWins: true });
  const portless = opts.portless ?? process.env.CARBON_PORTLESS !== "0";

  intro(minimal ? "Carbon · dev up (minimal)" : "Carbon · dev up");
  await ensureDockerRunning();

  // A Ctrl+C during the long pre-apps phase (pulls, migrations, sudo) would
  // orphan half-booted containers: tear them down. Detached once the apps
  // take over teardown.
  let interrupted = false;
  const detachEarly = onShutdown(() => {
    if (interrupted) return;
    interrupted = true;
    process.stderr.write("\ninterrupted — stopping partial stack…\n");
    stopAuxApps();
    void teardown(stackAt(root), { plain: true }).finally(() =>
      process.exit(130)
    );
  });

  if (portless) {
    await ensurePortlessInstalled();
    await ensureProxyPrivileges();
  } else {
    log.info("portless disabled — using localhost URLs");
  }

  const selectedApps = await selectApps(opts);
  const runsProcesses = APPS.some(
    (a) => a.kind !== "service" && selectedApps.includes(a.id)
  );
  const size: StackSize = {
    minimal,
    full: !minimal && opts.full === true,
    studio: selectedApps.includes("studio")
  };
  const slug = resolveSlug(root);

  // A borrowed stack runs already: no slug to guard.
  const borrowSlug = opts.borrow ? await pickBorrowSlug(slug) : undefined;
  if (borrowSlug) log.info(`borrowing containers from: ${borrowSlug}`);
  else await ensureSlugAvailable(slug, root);

  persistSlug(root, slug);
  // A borrowed stack keeps the mode it was started in.
  const borrowed = borrowSlug ? getSlot(borrowSlug) : null;
  const mode: StackMode = borrowed
    ? stackAt(borrowed.worktreeRoot, borrowSlug).mode
    : opts.isolated
      ? "isolated"
      : "shared";
  log.info(
    `worktree: ${slug}  (${mode === "shared" ? "shared containers" : "isolated stack"})`
  );

  const refreshed = await syncStaleCopyFiles(root);
  if (refreshed.length > 0) {
    log.info(`refreshed ${refreshed.join(", ")} from the main checkout`);
  }
  // Outside `tasks`, so pnpm's progress streams when it installs.
  if (await installDeps(root)) log.step("pnpm install");
  else log.info("pnpm install skipped (lockfile in sync)");
  // The skill links are gitignored, and `prepare` runs only with an install.
  if (await installSkills(root)) log.step("skills + rules linked");
  // Written once the installs are done: a failed install leaves the mode of
  // the stack that is still running.
  if (!borrowSlug) writeStackMode(slug, mode);

  const ctx = await provision({
    root,
    slug,
    mode,
    prefix: portless ? branchToPrefix(await currentBranch(root), slug) : null,
    includeAssembler: selectedApps.includes("assembler"),
    borrowSlug
  });
  if (!borrowSlug) {
    await pullImages(ctx, { force: opts.pull === true, size });
    await bootDockerStack(ctx, size);
  }
  await waitForServices(ctx);
  await tasks(
    databaseTasks(ctx, {
      migrate: shouldMigrate,
      regen: shouldRegen,
      swagger: true
    })
  );
  // The `user` table exists only once migrations ran.
  if (shouldMigrate) {
    await tasks([
      {
        title: "Seed smoke-test user (test@carbon.ms)",
        task: async () =>
          (await ensureSmokeTestUser(root, ctx.db, ctx.ports.PORT_API)).seeded
            ? "user created"
            : "already exists"
      }
    ]);
  }
  // The dev servers' own aliases come up with `holdRoutes`, below.
  // --run holds no URLs: its command needs the apps' aliases from the start.
  const held =
    opts.run === undefined
      ? reactRouterApps(selectedApps).map((a) => a.id)
      : [];
  if (ctx.prefix !== null) await setupPortless(ctx.prefix, ctx.ports, held);

  const stripe =
    process.env.CARBON_EDITION === "cloud" ? spawnStripeListener(root) : null;
  if (stripe) log.info("stripe listener spawned (CARBON_EDITION=cloud)");
  if (selectedApps.includes("assembler")) {
    spawnAssembler({ root, ports: ctx.ports });
  }
  if (selectedApps.includes("email")) {
    spawnEmailPreview({ root, ports: ctx.ports });
  }

  printSummary(ctx, selectedApps, size);
  detachEarly();

  if (opts.run !== undefined) {
    outro("apps starting, then running command");
    await runAppsThenCommand(
      ctx,
      selectedApps,
      opts.run,
      opts.volumes ?? false
    );
    return;
  }
  if (!runsProcesses) {
    // The stack outlives crbn: so does the stripe listener.
    stripe?.unref();
    outro("services up (run `crbn down` to stop)");
    return;
  }
  outro("apps starting (Ctrl+C to stop)");
  // The dev servers report traffic for the stack they talk to: the borrowed
  // one, whose own `crbn up` hibernates it.
  const stateDir = stackAt(root, borrowSlug ?? slug).stateDir;
  // A marker a reused pid keeps alive would hold every request.
  if (!borrowSlug) rmSync(asleepFile(stateDir), { force: true });
  await runAppsThenTeardown(ctx, selectedApps, size, {
    hibernate: opts.hibernate !== false && !borrowSlug,
    stateDir
  });
}

async function selectApps(opts: UpOpts): Promise<AppId[]> {
  if (opts.apps === false) return [];
  const selected = opts.all
    ? // --all takes the assembler only when its one-time native build exists;
      // picked on its own, a missing build fails below.
      APPS.map((a) => a.id).filter((id) => {
        if (id !== "assembler" || assemblerMissingPrerequisite() === null) {
          return true;
        }
        log.warn(
          "assembler skipped from --all: Rust, FCL or its OCCT build isn't present (pick the assembler on its own to see what to install)"
        );
        return false;
      })
    : await pickApps();
  // Before booting anything heavy.
  if (selected.includes("assembler")) {
    const missing = assemblerMissingPrerequisite();
    if (missing) throw new Error(missing);
  }
  return selected;
}

async function provision(opts: {
  root: string;
  slug: string;
  mode: StackMode;
  prefix: string | null;
  includeAssembler: boolean;
  borrowSlug?: string;
}): Promise<Ctx> {
  const { root, slug, mode, prefix, borrowSlug } = opts;
  // The worktree whose containers run: the borrowed one under --borrow.
  const stackSlug = borrowSlug ?? slug;
  const database = stackDatabase(stackSlug, mode);
  let ctx!: Ctx;
  await tasks([
    {
      title: borrowSlug ? "Configure (borrowed slot)" : "Configure the slot",
      task: async () => {
        // Always this worktree's own slot: its dev-server ports must not
        // collide with the borrowed stack's dev servers.
        const own = await resolveSlot(slug, root);
        // localhost mode pins its URLs, so OAuth redirect URIs are registered
        // with Google/Azure once.
        if (prefix === null && !borrowSlug) {
          Object.assign(own.ports, LOCALHOST_PORTS);
        }
        const borrowed = borrowSlug ? getSlot(borrowSlug) : null;
        if (borrowSlug && !borrowed) {
          throw new Error(`No slot found for worktree "${borrowSlug}"`);
        }
        const slot: Slot = borrowed
          ? {
              ...borrowed,
              ports: {
                ...borrowed.ports,
                PORT_ERP: own.ports.PORT_ERP,
                PORT_MES: own.ports.PORT_MES,
                PORT_EMAIL: own.ports.PORT_EMAIL
              }
            }
          : { ...own, worktreeRoot: root };
        writeStackEnv(root, {
          slug,
          ...slot,
          prefix,
          includeAssembler: opts.includeAssembler,
          mode,
          database
        });
        const ports = stackPorts(slot.ports, mode);
        ctx = {
          ...stackAt(root, slug),
          mode,
          slot,
          ports,
          db: { port: ports.PORT_DB, database },
          hosts: stackHosts(mode, stackSlug),
          jwt: slot.jwt,
          prefix,
          freshDatabase: false
        };
        const where = borrowed
          ? `borrowed backend ports, own app ports (ERP :${ports.PORT_ERP} MES :${ports.PORT_MES})`
          : prefix !== null
            ? `prefix "${prefix}"`
            : "localhost mode";
        return `${where}, redis db ${slot.redisDb}`;
      }
    },
    {
      title: "Sync env symlinks",
      task: async () => {
        await syncEnvSymlinks(root);
        return "env files synced";
      }
    },
    {
      title:
        mode === "shared"
          ? "Boot shared containers"
          : "Boot shared redis and edge runtime",
      task: async () => {
        // An isolated stack runs its own Postgres and Storage, but the shared
        // redis and edge runtime.
        const warning =
          mode === "shared"
            ? await bootSharedServices(ctx.jwt)
            : await bootSharedForIsolated(ctx.jwt);
        if (warning) log.warn(warning);
        return mode === "shared"
          ? `crbn-shared up (Postgres :${SHARED_DB_PORT}, pooler :${SHARED_POOLER_PORT}, mail :${SHARED_INBUCKET_PORT}, redis :${SHARED_REDIS_PORT} index ${ctx.slot.redisDb}, edge runtime)`
          : `shared redis on :${SHARED_REDIS_PORT} (index ${ctx.slot.redisDb}) and edge runtime, isolated stack`;
      }
    },
    {
      title: "Create the worktree database",
      enabled: mode === "shared" && !borrowSlug,
      task: async () => {
        ctx.freshDatabase = await provisionWorktreeData(database, ctx.jwt);
        return ctx.freshDatabase
          ? `${database} cloned from carbon_template`
          : `${database} exists`;
      }
    }
  ]);
  return ctx;
}

// Outside `tasks()`: clack's progress bar (a tick per `<service> Pulled`)
// can't render inside a task's spinner.
async function pullImages(ctx: Ctx, opts: { force: boolean; size: StackSize }) {
  if (!opts.force) {
    const refs = await devComposeImageRefs(ctx, opts.size);
    if (refs && (await allImagesPresentLocally(refs))) {
      log.info("docker images already present — skipping compose pull");
      return;
    }
  }
  const services = await listComposeServices(ctx, opts.size);
  const bar = progress({ style: "heavy", max: Math.max(services.length, 1) });
  bar.start(
    opts.size.minimal
      ? "Pulling docker images (minimal)"
      : "Pulling docker images"
  );
  try {
    await pullStack(
      ctx,
      (line) => {
        // Layer lines ("98daf4da4175 Downloading 67.37MB") arrive many times
        // a second; show the service lines only.
        if (/^[0-9a-f]{12}\b/.test(line)) return;
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
      ? "Boot docker compose stack (full — with studio/meta/private edge-runtime/imgproxy)"
      : size.studio
        ? "Boot docker compose stack (with studio/meta)"
        : "Boot docker compose stack";
  await tasks([
    {
      title: label,
      task: async () => {
        // GoTrue and Realtime build their schemas when they start, and
        // PostgREST caches the schema: containers from before a new database
        // (a reset shared volume, `prune --all`) would run against it without.
        if (ctx.freshDatabase) {
          await removeServices(ctx, ["gotrue", "realtime", "postgrest"]);
        }
        await bootStack(ctx, size);
        return "containers up";
      }
    }
  ]);
}

// 3 TCP ports, then Postgres, then the service schemas: 5 ticks.
async function waitForServices(ctx: Ctx) {
  const bar = progress({ style: "heavy", max: 5 });
  bar.start("Waiting for services");
  try {
    await waitForTcp(
      [ctx.db.port, ctx.ports.PORT_API, ctx.ports.PORT_INNGEST],
      { onProgress: (line) => bar.advance(1, line.slice(0, 80)) }
    );
    bar.message("waiting for postgres to accept queries");
    await waitForPostgres(ctx.db);
    bar.advance(1, "postgres ready");
    await waitForStorageReady(ctx.db, {
      onProgress: (line) => bar.message(line.slice(0, 80)),
      // The heal re-applies init.sql and restarts the private Storage. The
      // shared Storage builds each tenant's schema when the tenant registers.
      onHeal:
        ctx.mode === "shared"
          ? undefined
          : async () => {
              bar.message("storage stuck — re-applying init.sql");
              await applyBootstrapSql(ctx.root, ctx.db);
              bar.message("restarting storage / gotrue / postgrest");
              await restartServices(ctx, ["storage", "gotrue", "postgrest"]);
            },
      onTimeout: () => dumpStorageDiagnostics(ctx)
    });
    bar.message("waiting for auth / realtime schemas");
    await waitForServiceSchemas(ctx.db);
    bar.advance(1, "service schemas ready");
    bar.stop("all services responding");
  } catch (err) {
    bar.stop("services not ready");
    throw err;
  }
}

async function setupPortless(
  prefix: string,
  ports: PortMap,
  held: readonly AppId[]
) {
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
        startProxyDaemon();
        msg("waiting for proxy on :443");
        await waitForProxyReady();
        return "proxy listening";
      }
    },
    {
      title: "Register service aliases",
      task: async () => {
        const { registered, total } = await registerAliases(
          prefix,
          ports,
          held
        );
        return registered === total
          ? `${registered} aliases registered`
          : `${registered}/${total} aliases registered (${total - registered} failed)`;
      }
    }
  ]);
  await ensureHostsFile();
}

// A root proxy writes /etc/hosts itself when routes.json changes (fs.watch),
// a moment after the aliases land. Otherwise, or when it falls behind, sudo.
async function ensureHostsFile() {
  if (proxyRunsAsRoot()) {
    const synced = await waitUntil(async () => hostsFileInSync(), {
      timeoutMs: 3_000,
      intervalMs: 300
    });
    if (synced) {
      log.info("/etc/hosts verified in sync");
      return;
    }
    log.warn("/etc/hosts not in sync after 3s — falling back to manual sync");
  } else if (hostsFileInSync()) {
    log.info("/etc/hosts already in sync — skipping sudo");
    return;
  }
  log.step("sudo portless hosts sync");
  await syncHostsFile();
}

function printSummary(ctx: Ctx, apps: AppId[], size: StackSize) {
  const summary = summaryLines({
    ports: ctx.ports,
    apps,
    prefix: ctx.prefix,
    studioRunning: size.full === true || size.studio === true,
    db: ctx.db,
    shared: ctx.mode === "shared"
  });
  // Some non-interactive terminals (Conductor's run pane) report a width of
  // 0, for which clack's box computes a negative repeat count and throws.
  if (process.stdout.columns === 0) {
    log.info(`Carbon dev — ${ctx.slug}`);
    for (const line of summary) log.message(line);
  } else {
    box(summary.join("\n"), `Carbon dev — ${ctx.slug}`);
  }
}

const appRoutes = (ctx: Ctx, apps: AppId[]) =>
  reactRouterApps(apps).map((a) => ({
    id: a.id,
    alias: routeAlias(a.id, ctx.prefix ?? ""),
    port: ctx.ports[ROUTES[a.id]]
  }));

// Until each dev server answers, its URL shows a "starting" page instead of
// portless's 502.
const holdUrls = (ctx: Ctx, apps: AppId[]) =>
  ctx.prefix === null ? undefined : () => holdRoutes(appRoutes(ctx, apps));

async function runAppsThenTeardown(
  ctx: Ctx,
  selectedApps: AppId[],
  size: StackSize,
  opts: { hibernate: boolean; stateDir: string }
) {
  const apps = reactRouterApps(selectedApps).map((a) => a.id);
  // `parked`: the dev servers were stopped on purpose and start again.
  let parked = false;
  let stopApps: AbortController | undefined;
  let appsExited: Promise<void> = Promise.resolve();
  let resume: (() => void) | undefined;

  const idleMinutes = minutesFromEnv("CRBN_IDLE_MINUTES", IDLE_MINUTES);
  const stopHibernating =
    opts.hibernate && idleMinutes > 0 && apps.length > 0
      ? superviseIdle({
          stateDir: opts.stateDir,
          idleMs: idleMinutes * 60_000,
          deepMs:
            minutesFromEnv("CRBN_APPS_IDLE_MINUTES", APPS_IDLE_MINUTES) *
            60_000,
          appPorts: appRoutes(ctx, selectedApps).map((r) => r.port),
          stopContainers: () => sleepStack(ctx),
          startContainers: async () => {
            await bootStack(ctx, size);
            await waitForPostgres(ctx.db);
            await waitForApi(ctx.ports.PORT_API, ctx.jwt.serviceKey);
          },
          parkApps: async () => {
            parked = true;
            stopApps?.abort();
            await appsExited;
          },
          resumeApps: () => {
            parked = false;
            resume?.();
          },
          holdUrls: holdUrls(ctx, selectedApps),
          log: (line) => process.stderr.write(`${pc.cyan("•")} ${line}\n`)
        })
      : undefined;
  // Released before the teardown: a request (the waiting page polls every
  // 1.5 s) can start a wake at any moment, and one during the teardown would
  // leave containers no `crbn up` owns.
  const firstBoot = await holdUrls(ctx, selectedApps)?.();

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
      stopApps = new AbortController();
      appsExited = spawnApps({
        root: ctx.root,
        apps,
        ports: ctx.ports,
        portless: ctx.prefix !== null,
        signal: stopApps.signal,
        stateDir: opts.stateDir
      });
      await appsExited;
      // Exited on their own or on Ctrl+C: tear down. Parked: wait for the
      // wake (or a Ctrl+C, which spawnApps is no longer listening for).
      if (!parked) break;
      const interrupted = await new Promise<boolean>((resolve) => {
        // Not removed from inside the signal: execa's cleanup hook re-raises
        // a signal it finds nobody else listening for, and a wake has a
        // docker child running. It stays until the teardown listener is in.
        detachParked = onShutdown(() => resolve(true));
        resume = () => {
          detachParked?.();
          detachParked = undefined;
          resolve(false);
        };
      });
      if (interrupted) break;
    }
  }

  // A second Ctrl+C during the teardown must not exit mid-`compose stop`.
  const detach = onShutdown(() => {
    process.stderr.write("\nfinishing teardown — please wait\n");
  });
  detachParked?.();
  try {
    await firstBoot?.stop();
    await stopHibernating?.();
    stopAuxApps();
    await teardown(stackAt(ctx.root, ctx.slug), { plain: true });
  } finally {
    detach();
  }
}

/** Boot the apps, run `command` once they answer, then tear the stack down. */
async function runAppsThenCommand(
  ctx: Ctx,
  selectedApps: AppId[],
  command: string,
  volumes: boolean
) {
  const controller = new AbortController();
  const appsDone = spawnApps({
    root: ctx.root,
    apps: reactRouterApps(selectedApps).map((a) => a.id),
    ports: ctx.ports,
    portless: ctx.prefix !== null,
    signal: controller.signal
  }).catch((err: Error) => log.error(`dev servers: ${err.message}`));
  const detach = onShutdown(() => controller.abort());

  let exitCode = 0;
  try {
    await Promise.all(
      appRoutes(ctx, selectedApps).map(async ({ id, port }) => {
        const up = await waitUntil(() => httpResponds(port), {
          timeoutMs: 180_000,
          intervalMs: 1500
        });
        if (up) log.info(`${id} reachable on :${port}`);
        else
          log.warn(`${id} not reachable on :${port} — running command anyway`);
      })
    );
    log.step(`running: ${command}`);
    const res = await execa(command, {
      cwd: ctx.root,
      shell: true,
      stdio: "inherit",
      reject: false
    });
    exitCode = res.exitCode ?? 0;
  } finally {
    controller.abort();
    await appsDone;
    stopAuxApps();
    await teardown(stackAt(ctx.root, ctx.slug), { plain: true, volumes });
    detach();
  }
  process.exitCode = exitCode;
}

/** A number of minutes from an env var; 0 turns the wait off. */
function minutesFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new Error(`${name} must be a number of minutes, got "${raw}"`);
  }
  return minutes;
}

async function dumpStorageDiagnostics(ctx: Ctx) {
  // Shared mode: Postgres and Storage are crbn-shared's containers.
  const shared = ctx.mode === "shared";
  const containers = shared
    ? await listSharedContainers()
    : await listContainers(ctx);
  const logs = async (service: "postgres" | "storage", lines: number) =>
    shared
      ? tailSharedLogs(service, lines)
      : tailServiceLogs(ctx, service, lines);
  const out: string[] = ["", "--- container state ---"];
  for (const name of ["postgres", "storage"]) {
    out.push(formatContainerLine(name, containers));
  }
  out.push("", "--- storage logs (last 50) ---");
  out.push(await logs("storage", 50));
  out.push("", "--- postgres logs (last 20) ---");
  out.push(await logs("postgres", 20));
  out.push("");
  process.stderr.write(`${out.join("\n")}\n`);
}

function formatContainerLine(name: string, containers: Container[]): string {
  const c = containers.find((x) => x.Service === name);
  if (!c) return `${name.padEnd(10)} (not found)`;
  return `${name.padEnd(10)} state=${c.State} health=${c.Health ?? "n/a"}  ${c.Status}`;
}
