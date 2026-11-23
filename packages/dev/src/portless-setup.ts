// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Getting portless ready on this machine: installing and updating it, and the
// one-time sudo setup of its proxy. These ask the user; services/portless.ts
// only runs it.

import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { confirm, isCancel, log } from "@clack/prompts";
import { execa } from "execa";
import { dirname } from "pathe";
import pc from "picocolors";
import { PORTLESS_MIN_VERSION, TLD } from "./constants.js";
import { paths } from "./paths.js";
import { requireTerminal } from "./prompts.js";
import { detectPortlessVersion, proxyIssue } from "./services/portless.js";
import { spinner } from "./ui.js";

// `sudo` keeps HOME, so portless's state lands in the user's ~/.portless,
// not /var/root/.portless.
function sudoPortless(args: string[]): string[] {
  return [`HOME=${homedir()}`, "portless", ...args];
}

function cmpSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

export async function ensurePortlessInstalled() {
  const installed = await detectPortlessVersion();
  if (installed && cmpSemver(installed, PORTLESS_MIN_VERSION) >= 0) {
    await offerPortlessUpdate(installed);
    return;
  }

  if (!installed) {
    log.warn(
      `portless is not installed globally. Required for app routing (${PORTLESS_MIN_VERSION}+).`
    );
  } else {
    log.warn(
      `portless v${installed} is too old. Need ${PORTLESS_MIN_VERSION}+ for monorepo + package.json config.`
    );
  }

  const autoYes = process.env.CARBON_DEV_YES === "1" || !process.stdin.isTTY;
  if (!autoYes) {
    const ok = await confirm({
      message: "Install portless@latest globally now?",
      initialValue: true
    });
    if (isCancel(ok) || !ok) {
      throw new Error(
        `Aborted. Install manually: ${pc.cyan("npm install -g portless@latest")} (or bun/pnpm equivalent).`
      );
    }
  } else {
    log.info("auto-installing portless (non-interactive / CARBON_DEV_YES=1)");
  }

  await installPortlessLatest();
}

async function installPortlessLatest() {
  const s = spinner();
  s.start("installing portless@latest globally (pnpm add -g)");
  const r = await execa("pnpm", ["add", "-g", "portless@latest"], {
    reject: false
  });
  if (r.exitCode !== 0) {
    s.stop("✗ install failed");
    const stderr = r.stderr ?? "";
    const stdout = r.stdout ?? "";
    const combined = `${stderr}\n${stdout}`;

    // Fresh dev box: pnpm has no global bin dir. Surface pnpm's setup fix.
    if (/ERR_PNPM_NO_GLOBAL_BIN_DIR/.test(combined)) {
      log.error("pnpm has no global bin directory configured.");
      log.message(
        [
          "To fix this, run pnpm's one-time setup (creates ~/.local/share/pnpm",
          "and writes PNPM_HOME to your shell rc), then re-run `crbn up`:",
          "",
          `    ${pc.cyan("pnpm setup")}`,
          `    ${pc.cyan("source ~/.zshrc   # or open a new shell")}`,
          `    ${pc.cyan("crbn up")}`,
          "",
          "Alternative — install portless via npm instead:",
          "",
          `    ${pc.cyan("npm install -g portless@latest")}`
        ].join("\n")
      );
      throw new Error("portless install aborted: pnpm global bin dir missing");
    }

    process.stderr.write(stderr);
    throw new Error(
      `pnpm add -g portless failed (exit ${r.exitCode}). Manual fallback: ${pc.cyan("npm install -g portless@latest")}`
    );
  }
  const after = await detectPortlessVersion();
  s.stop(`portless v${after ?? "?"} installed`);
}

// Once a day, `crbn up` asks npm for the latest portless. The file's mtime is
// when it last asked; `skipped` is a version the user declined, so it is
// offered once, not on every boot.
const UPDATE_CHECK_EVERY_MS = 24 * 60 * 60 * 1000;

type UpdateCheck = { latest: string | null; skipped: string | null };

function readUpdateCheck(): (UpdateCheck & { ageMs: number }) | null {
  try {
    const data = JSON.parse(readFileSync(paths.portlessUpdateCheck(), "utf8"));
    return {
      latest: typeof data.latest === "string" ? data.latest : null,
      skipped: typeof data.skipped === "string" ? data.skipped : null,
      ageMs: Date.now() - statSync(paths.portlessUpdateCheck()).mtimeMs
    };
  } catch {
    return null;
  }
}

function writeUpdateCheck(check: UpdateCheck) {
  try {
    mkdirSync(dirname(paths.portlessUpdateCheck()), { recursive: true });
    writeFileSync(paths.portlessUpdateCheck(), `${JSON.stringify(check)}\n`);
  } catch {
    // A missing cache only means npm is asked again next boot.
  }
}

async function fetchLatestPortless(): Promise<string | null> {
  try {
    const r = await fetch("https://registry.npmjs.org/portless/latest", {
      signal: AbortSignal.timeout(2000)
    });
    if (!r.ok) return null;
    const v = ((await r.json()) as { version?: unknown }).version;
    return typeof v === "string" && /^\d+\.\d+\.\d+$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** What to do about a newer portless: nothing, a one-line note, or a prompt. */
export function portlessUpdateAction(
  installed: string,
  latest: string | null,
  skipped: string | null,
  interactive: boolean
): "none" | "warn" | "ask" {
  if (!latest || cmpSemver(latest, installed) <= 0) return "none";
  return interactive && latest !== skipped ? "ask" : "warn";
}

// An update is opt-in: scripts and CARBON_DEV_YES=1 get a warning, never an
// upgrade. Offline or a slow registry never blocks the boot.
async function offerPortlessUpdate(installed: string) {
  if (process.env.CARBON_PORTLESS_UPDATE_CHECK === "0") return;
  const cached = readUpdateCheck();
  let latest = cached?.latest ?? null;
  const skipped = cached?.skipped ?? null;
  if (!cached || cached.ageMs > UPDATE_CHECK_EVERY_MS) {
    // Cached only on an answer: an offline boot asks again on the next one.
    const fetched = await fetchLatestPortless();
    if (fetched) {
      latest = fetched;
      writeUpdateCheck({ latest, skipped });
    }
  }
  const interactive =
    process.stdin.isTTY === true && process.env.CARBON_DEV_YES !== "1";
  const action = portlessUpdateAction(installed, latest, skipped, interactive);
  if (action === "none" || !latest) return;

  const managedByPnpm = await portlessInstalledByPnpm();
  const manual = managedByPnpm
    ? "pnpm add -g portless@latest"
    : "npm install -g portless@latest";
  if (action === "warn") {
    log.warn(
      `portless v${latest} is out (you have v${installed}). Update: ${pc.cyan(manual)}`
    );
    return;
  }
  // Another package manager owns it: a pnpm copy would shadow or be shadowed,
  // so give its command once for this version instead of offering to run one.
  if (!managedByPnpm) {
    writeUpdateCheck({ latest, skipped: latest });
    log.warn(
      `portless v${latest} is out (you have v${installed}). It was not installed with pnpm: update with ${pc.cyan(manual)}`
    );
    return;
  }
  const ok = await confirm({
    message: `portless v${latest} is out (you have v${installed}). Update now?`,
    initialValue: true
  });
  if (isCancel(ok) || !ok) {
    writeUpdateCheck({ latest, skipped: latest });
    log.info(
      `kept portless v${installed}; update later with ${pc.cyan(manual)}`
    );
    return;
  }
  try {
    await installPortlessLatest();
  } catch (err) {
    // An optional update: a failure stops crbn up only if portless is gone.
    const still = await detectPortlessVersion();
    if (!still || cmpSemver(still, PORTLESS_MIN_VERSION) < 0) throw err;
    writeUpdateCheck({ latest, skipped: latest });
    log.warn(
      `portless update failed (${(err as Error).message}); continuing on v${still}. Update later with ${pc.cyan(manual)}`
    );
    return;
  }
  // The proxy daemon keeps running the old binary until it restarts.
  log.info(
    `the running proxy restarts on the new version after ${pc.cyan("sudo portless proxy stop")} and the next ${pc.cyan("crbn up")}`
  );
}

async function portlessInstalledByPnpm(): Promise<boolean> {
  const [bin, which] = await Promise.all([
    execa("pnpm", ["bin", "-g"], { reject: false }),
    execa("sh", ["-c", "command -v portless"], { reject: false })
  ]);
  const pnpmBin = bin.stdout?.trim();
  const portlessBin = which.stdout?.trim();
  return !!pnpmBin && !!portlessBin && dirname(portlessBin) === pnpmBin;
}

// portless needs sudo to bind :443 and write /etc/hosts. `.dev` is a public
// HSTS-preloaded TLD so we rely on /etc/hosts (no /etc/resolver/<tld> for
// public TLDs).
export async function ensureProxyPrivileges() {
  const issue = proxyIssue();
  if (!issue) return;

  const isWindows = process.platform === "win32";

  log.warn(
    [
      "portless needs a privileged proxy to serve `*.dev` cleanly:",
      "",
      `  • ${issue}`,
      "",
      "Without :443 + /etc/hosts entries, browsers hit the public `.dev` TLD",
      "(NXDOMAIN) or you'd have to type `:<port>` after every URL."
    ].join("\n")
  );

  const elevateHint = isWindows
    ? "Will bind :443, install the local CA, and write hosts entries (requires Administrator terminal)."
    : "Set it up now? Will run sudo to bind :443, install the local CA, and write /etc/hosts entries.";

  requireTerminal(
    "Setting up the portless proxy (it runs sudo)",
    "Run `crbn up` once in a terminal, or pass --no-portless."
  );
  const proceed = await confirm({
    message: elevateHint,
    initialValue: true
  });
  if (isCancel(proceed) || !proceed) {
    const manual = isWindows
      ? "Aborted. Run in an Administrator terminal: `portless proxy stop && portless proxy start --tld dev && portless trust`. Then re-run `crbn up`."
      : "Aborted. Run manually: `sudo portless proxy stop && sudo portless proxy start --tld dev && sudo portless trust`. Then re-run `crbn up`.";
    throw new Error(manual);
  }

  if (isWindows) {
    log.info(
      "running privileged commands — ensure this terminal is running as Administrator"
    );
  } else {
    log.info("running sudo commands — you'll be prompted for your password");
  }

  const elevate = (args: string[]) =>
    isWindows
      ? execa("portless", args, { stdio: "inherit", reject: false })
      : execa("sudo", sudoPortless(args), { stdio: "inherit", reject: false });

  await elevate(["proxy", "stop"]);

  const start = await elevate(["proxy", "start", "--tld", TLD]);
  if (start.exitCode !== 0) {
    throw new Error(`portless proxy start failed (exit ${start.exitCode})`);
  }

  const trust = await elevate(["trust"]);
  if (trust.exitCode !== 0) {
    log.warn(
      `portless trust failed (exit ${trust.exitCode}); browsers may show cert warnings until you run it manually.`
    );
  }

  const remaining = proxyIssue();
  if (remaining) {
    throw new Error(`portless setup still incomplete:\n  • ${remaining}`);
  }

  log.success("portless proxy on :443");
}

// Push registered routes into /etc/hosts. Needs elevated privileges; idempotent.
export async function syncHostsFile() {
  const isWindows = process.platform === "win32";
  const cmd = isWindows ? "portless" : "sudo";
  const args = isWindows ? ["hosts", "sync"] : sudoPortless(["hosts", "sync"]);

  const r = await execa(cmd, args, {
    stdio: "inherit",
    reject: false
  });
  if (r.exitCode !== 0) {
    const hint = isWindows
      ? "Run this command in an Administrator terminal to fix DNS."
      : "Run it manually to fix DNS.";
    throw new Error(
      `${isWindows ? "" : "sudo "}portless hosts sync failed (exit ${r.exitCode}). ${hint}`
    );
  }
}
