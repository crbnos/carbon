// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { homedir } from "node:os";
import { stripVTControlCharacters } from "node:util";
import {
  progress as clackProgress,
  spinner as clackSpinner,
  type Task
} from "@clack/prompts";
import Table from "cli-table3";
import pc from "picocolors";
import {
  APPS,
  type AppId,
  ROUTE_STYLE,
  ROUTES,
  type RouteName,
  routeHost
} from "./constants.js";
import type { Container } from "./services/compose.js";
import { type DbTarget, dbUrl } from "./stack.js";
import { projectName, SHARED_REDIS_PORT } from "./topology.js";
import { PORT_NAMES, type PortMap } from "./worktree.js";

// clack redraws a spinner every 80 ms, which a pipe (an agent, a log file)
// records as thousands of frames. Its only static mode is keyed on CI=true,
// read when the spinner is created — so set it for that instant only, never
// for the process: the dev servers and pnpm crbn spawns must not inherit it.
function calm<T>(make: () => T): T {
  if (process.stdout.isTTY) return make();
  const prev = process.env.CI;
  process.env.CI = "true";
  try {
    return make();
  } finally {
    if (prev === undefined) delete process.env.CI;
    else process.env.CI = prev;
  }
}

// Every 80 ms clack erases the spinner line in one write and draws it again in
// the next. A terminal that paints between the two shows an empty line: the
// flicker. Hold writes that only move the cursor or erase, and send them with
// the next write that has text, as one synchronized update (DEC mode 2026;
// terminals without it ignore the markers).
export function steady(stream: NodeJS.WriteStream): NodeJS.WriteStream {
  let held = "";
  let callbacks: Array<(err?: Error | null) => void> = [];
  const flush = () => {
    if (!held) return;
    const data = `\x1b[?2026h${held}\x1b[?2026l`;
    const done = callbacks;
    held = "";
    callbacks = [];
    stream.write(data, (err) => {
      for (const cb of done) cb(err);
    });
  };
  // A write held when the process exits right after a spinner stops would be
  // lost, and with it the cursor-show: the terminal keeps a hidden cursor.
  process.once("exit", flush);
  // The rest of the stream (columns, isTTY, events) stays the real one:
  // clack's block() gives it to readline.
  const out = Object.create(stream) as NodeJS.WriteStream;
  out.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    const cb = rest.find((a) => typeof a === "function");
    if (cb) callbacks.push(cb as (err?: Error | null) => void);
    const text =
      typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    if (!held) queueMicrotask(flush);
    held += text;
    if (stripVTControlCharacters(text).trim()) flush();
    return true;
  }) as NodeJS.WriteStream["write"];
  return out;
}

// ◆ while running, ◇ when done: clack's own pair for an active and a finished
// step. Its default spinner frames (◒◐◓◑) come from a fallback font in most
// terminals and draw larger than the ◇ beside them.
// A pipe or a file gets the plain stream: no terminal paints it, and the
// sync markers would land in the log.
const SPINNER = {
  frames: ["◆"],
  output: process.stdout.isTTY ? steady(process.stdout) : process.stdout
};

export const spinner: typeof clackSpinner = (opts) =>
  calm(() => clackSpinner({ ...SPINNER, ...opts }));

export const progress: typeof clackProgress = (opts) =>
  calm(() => clackProgress({ ...SPINNER, ...opts }));

/**
 * Runs the enabled tasks in order. `plain` prints a line per task instead of
 * a spinner: after a Ctrl+C, clack's spinner fails with EIO setting raw mode
 * on the interrupted stdin.
 */
export async function tasks(list: Task[], opts: { plain?: boolean } = {}) {
  for (const t of list) {
    if (t.enabled === false) continue;
    if (opts.plain) {
      process.stderr.write(`${pc.cyan("•")} ${t.title}…\n`);
      const result = await t.task(() => undefined);
      process.stderr.write(`${pc.green("✓")} ${result || t.title}\n`);
      continue;
    }
    const s = spinner();
    s.start(t.title);
    const result = await t.task(s.message);
    s.stop(result || t.title);
  }
}

const BASE_STYLE = {
  style: { head: [], border: ["gray"] as string[] },
  chars: {
    mid: "",
    "left-mid": "",
    "mid-mid": "",
    "right-mid": ""
  }
};

export function portsTable(
  ports: PortMap,
  redisDb: number | undefined
): string {
  const t = new Table({
    head: [pc.bold("Service"), pc.bold("Port")],
    ...BASE_STYLE
  });
  for (const n of PORT_NAMES) {
    t.push([
      pc.cyan(n.replace("PORT_", "").toLowerCase()),
      ports[n] === undefined ? pc.dim("—") : pc.bold(String(ports[n]))
    ]);
  }
  t.push([
    pc.cyan("redis (shared)"),
    pc.bold(String(SHARED_REDIS_PORT)) +
      pc.dim(typeof redisDb === "number" ? ` /db ${redisDb}` : " /db ?")
  ]);
  return t.toString();
}

export function servicesTable(containers: Container[]): string {
  const sorted = [...containers].sort((a, b) =>
    a.Service.localeCompare(b.Service)
  );
  const t = new Table({
    head: [pc.bold("Service"), pc.bold("Status"), pc.bold("Ports")],
    ...BASE_STYLE
  });
  for (const c of sorted) {
    t.push([pc.cyan(c.Service), colorState(c.State, c.Health), formatPorts(c)]);
  }
  return t.toString();
}

export function worktreesTable(
  rows: {
    path: string;
    branch: string | null;
    current: boolean;
    slug: string | null;
    dockerState: string | null;
    mode?: string | null;
  }[],
  // Columns the table may use; clack's gutter takes four. A pipe has no width
  // and is never narrowed.
  width = process.stdout.columns ? process.stdout.columns - 4 : Infinity
): string {
  const t = new Table({
    head: [pc.bold("Worktree"), pc.bold("Branch"), pc.bold("Stack")],
    ...BASE_STYLE
  });
  const home = homedir();
  const stacked: string[] = [];
  for (const r of rows) {
    const path = r.path.startsWith(`${home}/`)
      ? `~${r.path.slice(home.length)}`
      : r.path;
    const project = r.slug
      ? `${projectName(r.slug)}${r.mode ? ` · ${r.mode}` : ""}`
      : "—";
    const stack = !r.slug
      ? pc.gray("not initialized")
      : r.dockerState === "running"
        ? pc.green(`● up · ${project}`)
        : r.dockerState === "hibernated"
          ? pc.blue(`◌ hibernated · ${project}`)
          : r.dockerState
            ? pc.yellow(`${r.dockerState} · ${project}`)
            : pc.dim(`registered · ${project}`);
    const branch = r.branch ? pc.cyan(r.branch) : pc.dim("(detached)");
    t.push([r.current ? pc.bold(pc.cyan(path)) : path, branch, stack]);
    stacked.push(
      `${r.current ? pc.bold(branch) : branch}  ${stack}\n  ${pc.dim(path)}`
    );
  }
  // A table wider than the terminal wraps mid-row and is unreadable; one
  // worktree per two lines reads at any width.
  const table = t.toString();
  const widest = Math.max(
    ...table.split("\n").map((line) => stripVTControlCharacters(line).length)
  );
  return widest <= width ? table : stacked.join("\n");
}

function colorState(state: string, health: string | null): string {
  const s = state.toLowerCase();
  if (s === "running" && health === "unhealthy")
    return pc.yellow("◑ unhealthy");
  if (s === "running" && health === "starting") return pc.yellow("◐ starting");
  if (s === "running") return pc.green("● running");
  if (s === "restarting") return pc.yellow("◌ restarting");
  if (s === "exited") return pc.red("✗ exited");
  if (s === "created") return pc.gray("○ created");
  return pc.dim(state);
}

function formatPorts(c: Container): string {
  if (c.Publishers.length === 0) return pc.dim("—");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of c.Publishers) {
    if (!p.PublishedPort) continue;
    const key = `${p.PublishedPort}:${p.TargetPort}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(
      `${pc.cyan(String(p.PublishedPort))}${pc.dim("→" + p.TargetPort)}`
    );
  }
  return out.length ? out.join(" ") : pc.dim("—");
}

/** The URLs and database DSNs `crbn up` prints when the stack is up. */
export function summaryLines(opts: {
  ports: PortMap;
  apps: readonly AppId[];
  /** The portless host prefix; null prints localhost URLs. */
  prefix: string | null;
  /** False when the boot left Studio out; the row then says how to start it. */
  studioRunning: boolean;
  db: DbTarget;
  shared: boolean;
}): string[] {
  const { ports, prefix } = opts;
  const lines: string[] = [];
  for (const name of Object.keys(ROUTES) as RouteName[]) {
    const app = APPS.find((a) => a.id === name);
    // Only the processes that run; a compose service has its row anyway.
    if (app && app.kind !== "service" && !opts.apps.includes(app.id)) continue;
    const { label, color } = ROUTE_STYLE[name];
    if (name === "studio" && !opts.studioRunning) {
      lines.push(
        `${pc.dim(label.padEnd(8))}  ${pc.dim("not started — crbn reload studio")}`
      );
      continue;
    }
    const port = ports[ROUTES[name]];
    const url =
      prefix === null
        ? `http://localhost:${port}`
        : `https://${routeHost(name, prefix)}`;
    // Behind portless, the port the host reaches, for a tool that needs it.
    const tag =
      prefix !== null && app?.kind !== "react-router" ? port : undefined;
    lines.push(row(pc[color], label, url, tag));
  }
  const dsn = (label: string, url: string) =>
    `${pc.gray(pc.bold(label.padEnd(8)))}  ${pc.gray(url)}`;
  lines.push(dsn("Postgres", dbUrl(opts.db)));
  if (opts.shared) {
    lines.push(
      dsn(
        "Pooler",
        dbUrl({ port: ports.PORT_POOLER, database: opts.db.database })
      ),
      dsn(
        "Shared",
        "Postgres, PgBouncer, Storage, Mail, Redis and the edge runtime run in crbn-shared"
      )
    );
  }
  return lines;
}

/**
 * OSC 8 hyperlink. Supported by iTerm2, Terminal.app, Warp, kitty, etc.
 * Falls back to plain text in unsupported terminals.
 */
function link(url: string, text?: string): string {
  const label = text ?? url;
  return `\x1b]8;;${url}\x1b\\${label}\x1b]8;;\x1b\\`;
}

function row(
  color: (s: string) => string,
  label: string,
  url: string,
  port?: number
): string {
  const lbl = color(pc.bold(label.padEnd(8)));
  const target = color(link(url));
  const portTag = port ? `  ${pc.dim(`:${port}`)}` : "";
  return `${lbl}  ${target}${portTag}`;
}
