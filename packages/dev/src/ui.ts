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
import { type AppId, TLD } from "./constants.js";
import type { Container } from "./services/compose.js";
import {
  PORT_NAMES,
  type PortMap,
  projectName,
  SHARED_REDIS_PORT
} from "./worktree.js";

// ---------------------------------------------------------------------------
// Spinners
// ---------------------------------------------------------------------------

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

export const spinner: typeof clackSpinner = (opts) =>
  calm(() => clackSpinner(opts));

export const progress: typeof clackProgress = (opts) =>
  calm(() => clackProgress(opts));

export async function tasks(list: Task[]) {
  for (const t of list) {
    if (t.enabled === false) continue;
    const s = spinner();
    s.start(t.title);
    const result = await t.task(s.message);
    s.stop(result || t.title);
  }
}

// ---------------------------------------------------------------------------
// Tables (status / list)
// ---------------------------------------------------------------------------

/** Common cli-table3 style: gray border, no inter-row separators. */
const BASE_STYLE = {
  style: { head: [], border: ["gray"] as string[] },
  chars: {
    mid: "",
    "left-mid": "",
    "mid-mid": "",
    "right-mid": ""
  }
};

/** Per-worktree port + redis-db assignment table. */
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

/** Compose-stack health table for `dev status`. */
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

/** Worktree list table for `dev list`. */
export function worktreesTable(
  rows: {
    path: string;
    branch: string | null;
    current: boolean;
    slug: string | null;
    dockerState: string | null;
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
    const project = r.slug ? projectName(r.slug) : "—";
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

// ---------------------------------------------------------------------------
// Summary (boxed URLs printed after `crbn up`)
// ---------------------------------------------------------------------------

/** Boxed list of URLs + DB DSN for the up-summary. */
export function summaryLines(
  ports: PortMap,
  apps: readonly AppId[],
  /** When provided, show portless hostnames; otherwise show localhost URLs. */
  branchPrefix?: string,
  /** False when the boot left Studio out; the row then says how to start it. */
  studioRunning = true
): string[] {
  const url = branchPrefix
    ? (sub: string, _port?: number) => `https://${sub}.${branchPrefix}.${TLD}`
    : (sub: string, port: number) => `http://localhost:${port}`;
  const dbUrl = `postgresql://postgres:postgres@localhost:${ports.PORT_DB}/postgres`;
  const lines: string[] = [];
  if (apps.includes("erp"))
    lines.push(row(pc.cyan, "ERP", url("erp", ports.PORT_ERP)));
  if (apps.includes("mes"))
    lines.push(row(pc.magenta, "MES", url("mes", ports.PORT_MES)));
  lines.push(
    row(
      pc.green,
      "API",
      url("api", ports.PORT_API),
      branchPrefix ? ports.PORT_API : undefined
    ),
    studioRunning
      ? row(
          pc.green,
          "Studio",
          url("studio", ports.PORT_STUDIO),
          branchPrefix ? ports.PORT_STUDIO : undefined
        )
      : `${pc.dim("Studio".padEnd(8))}  ${pc.dim("not started — crbn reload studio")}`,
    row(
      pc.yellow,
      "Mail",
      url("mail", ports.PORT_INBUCKET),
      branchPrefix ? ports.PORT_INBUCKET : undefined
    ),
    ...(apps.includes("email")
      ? [
          row(
            pc.yellow,
            "Email",
            url("email", ports.PORT_EMAIL),
            branchPrefix ? ports.PORT_EMAIL : undefined
          )
        ]
      : []),
    row(
      pc.blue,
      "Inngest",
      url("inngest", ports.PORT_INNGEST),
      branchPrefix ? ports.PORT_INNGEST : undefined
    ),
    ...(apps.includes("assembler")
      ? [
          row(
            pc.yellow,
            "Assembler",
            url("assembler", ports.PORT_ASSEMBLER),
            branchPrefix ? ports.PORT_ASSEMBLER : undefined
          )
        ]
      : []),
    `${pc.gray(pc.bold("Postgres".padEnd(8)))}  ${pc.gray(dbUrl)}`
  );
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
