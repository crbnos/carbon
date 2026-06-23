import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "pathe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PortMap } from "../worktree.js";
import { spawnApps } from "./apps.js";

// A stand-in "dev server": a real child process we can make crash on demand.
// It appends its app id to a shared log on every launch (so the test can count
// restarts), exits 0 on SIGTERM/SIGINT (clean shutdown), and otherwise:
//   mode "crash"   -> always exit 1 (perpetual crash loop)
//   mode "flaky"   -> exit 1 until it has launched > crashTimes, then stay up
//   mode "healthy" -> stay up until signaled
const DEV_SERVER = `
const fs = require("node:fs");
const [, , app, log, mode, crashTimes] = process.argv;
fs.appendFileSync(log, app + "\\n");
const launches = fs.readFileSync(log, "utf8").split("\\n").filter((l) => l === app).length;
const quit = () => process.exit(0);
process.on("SIGTERM", quit);
process.on("SIGINT", quit);
if (mode === "crash") process.exit(1);
if (mode === "flaky" && launches <= Number(crashTimes)) process.exit(1);
setInterval(() => {}, 1 << 30);
`;

const ports = { PORT_ERP: 39001, PORT_MES: 39002 } as unknown as PortMap;

let tmpRoot: string;
let scriptPath: string;
let logPath: string;
let active: { controller: AbortController; done: Promise<void> } | undefined;
let stderr: string[];

const countLaunches = (app: string): number =>
  existsSync(logPath)
    ? readFileSync(logPath, "utf8")
        .split("\n")
        .filter((l) => l === app).length
    : 0;

const waitFor = async (
  pred: () => boolean,
  { timeout = 12_000, interval = 25 } = {}
): Promise<void> => {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeout) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, interval));
  }
};

const startStack = (cfg: {
  apps: string[];
  modes: Record<string, string>;
  crashTimes?: Record<string, number>;
}) => {
  const controller = new AbortController();
  const done = spawnApps({
    root: tmpRoot,
    apps: cfg.apps,
    ports,
    portless: false,
    signal: controller.signal,
    command: ({ id }) => ({
      file: process.execPath,
      args: [
        scriptPath,
        id,
        logPath,
        cfg.modes[id] ?? "healthy",
        String(cfg.crashTimes?.[id] ?? 0)
      ]
    })
  });
  active = { controller, done };
  return { controller, done };
};

describe("spawnApps supervisor (integration)", () => {
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "carbon-apps-"));
    mkdirSync(join(tmpRoot, "apps", "erp"), { recursive: true });
    mkdirSync(join(tmpRoot, "apps", "mes"), { recursive: true });
    scriptPath = join(tmpRoot, "dev-server.cjs");
    logPath = join(tmpRoot, "launches.log");
    writeFileSync(scriptPath, DEV_SERVER);
    stderr = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      stderr.push(String(chunk));
      return true;
    });
  });

  afterEach(async () => {
    // Make sure no real child process is left running, then clean up.
    active?.controller.abort();
    await active?.done.catch(() => {});
    active = undefined;
    vi.restoreAllMocks();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("auto-recovers a flaky dev server and leaves it running", async () => {
    const { controller, done } = startStack({
      apps: ["erp"],
      modes: { erp: "flaky" },
      crashTimes: { erp: 2 } // crash twice, then stay up on the 3rd launch
    });

    // Restarts through both crashes and reaches a healthy 3rd launch.
    await waitFor(() => countLaunches("erp") === 3);

    // It stays at 3 — the supervisor stops restarting once it's healthy.
    await new Promise((r) => setTimeout(r, 400));
    expect(countLaunches("erp")).toBe(3);
    expect(stderr.join("")).toContain(
      "erp dev server exited (code 1); restarting"
    );
    expect(stderr.join("")).not.toContain("giving up");

    // Clean programmatic shutdown resolves the stack.
    controller.abort();
    await expect(done).resolves.toBeUndefined();
  }, 20_000);

  it("restarts only the crashed app; the sibling is untouched", async () => {
    const { controller, done } = startStack({
      apps: ["erp", "mes"],
      modes: { erp: "flaky", mes: "healthy" },
      crashTimes: { erp: 1 } // erp crashes once then recovers
    });

    await waitFor(() => countLaunches("erp") === 2);
    // mes was started exactly once and never bounced.
    expect(countLaunches("mes")).toBe(1);
    await new Promise((r) => setTimeout(r, 300));
    expect(countLaunches("mes")).toBe(1);

    controller.abort();
    await expect(done).resolves.toBeUndefined();
  }, 20_000);

  it("gives up after a crash loop, with real backoff, and tears down", async () => {
    const start = Date.now();
    const { done } = startStack({
      apps: ["erp"],
      modes: { erp: "crash" } // never recovers
    });

    // No abort needed — give-up triggers teardown internally and resolves.
    await expect(done).resolves.toBeUndefined();
    const elapsed = Date.now() - start;

    // initial launch + 3 restarts, then give up on the 4th crash — no 5th.
    expect(countLaunches("erp")).toBe(4);
    const out = stderr.join("");
    expect(out).toContain("restarting in 500ms");
    expect(out).toContain("restarting in 1000ms");
    expect(out).toContain("restarting in 2000ms");
    expect(out).toContain(
      "erp dev server crashed 4× in 10s (code 1); giving up"
    );
    expect(out).toContain("stopping apps…");

    // Real exponential backoff means it can't have given up faster than
    // 500 + 1000 + 2000 ms.
    expect(elapsed).toBeGreaterThanOrEqual(3_400);
  }, 20_000);
});
