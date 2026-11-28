// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readlinkSync } from "node:fs";
import { confirm, isCancel, log } from "@clack/prompts";
import { execa } from "execa";
import { waitUntil } from "../helpers.js";
import { abort } from "../prompts.js";
import { spinner } from "../ui.js";

export type DockerRuntime = { name: string; command: string; args: string[] };

/** A cold Docker Desktop start takes 20–60 s. */
export const DOCKER_START_TIMEOUT_MS = 120_000;

const DEFAULT_SOCKET = "/var/run/docker.sock";

export type DockerStartMode = "off" | "ask" | "auto";

export function dockerStartMode(
  env: NodeJS.ProcessEnv,
  isTTY: boolean
): DockerStartMode {
  if (env.CARBON_DOCKER_AUTOSTART === "0") return "off";
  if (env.CARBON_DEV_YES === "1" || !isTTY) return "auto";
  return "ask";
}

/**
 * The runtime behind a `unix://` endpoint, told apart by its socket path; the
 * default socket is followed through its link. Null for TCP, SSH or a system
 * dockerd, which needs sudo to start.
 */
export function dockerRuntime(
  endpoint: string | null,
  platform: NodeJS.Platform,
  defaultSocketLink: string | null
): DockerRuntime | null {
  if (!endpoint?.startsWith("unix://")) return null;
  let socket = endpoint.slice("unix://".length);
  if (socket === DEFAULT_SOCKET) {
    if (!defaultSocketLink) return null;
    socket = defaultSocketLink;
  }

  if (socket.endsWith("/.docker/run/docker.sock") && platform === "darwin") {
    return {
      name: "Docker Desktop",
      command: "open",
      args: ["-g", "-a", "Docker"]
    };
  }
  if (socket.endsWith("/.docker/desktop/docker.sock") && platform === "linux") {
    return {
      name: "Docker Desktop",
      command: "systemctl",
      args: ["--user", "start", "docker-desktop"]
    };
  }
  if (socket.endsWith("/.orbstack/run/docker.sock")) {
    return { name: "OrbStack", command: "orbctl", args: ["start"] };
  }
  // ~/.colima/<profile>/docker.sock, or under ~/.config/colima with XDG.
  const colima = socket.match(/\/\.?colima\/([^/]+)\/docker\.sock$/);
  if (colima?.[1]) {
    const profile = colima[1];
    return {
      name: "Colima",
      command: "colima",
      args: profile === "default" ? ["start"] : ["start", "--profile", profile]
    };
  }
  return null;
}

/** The endpoint the docker CLI would use: `DOCKER_HOST`, else the current
 *  context's. Reading it does not need the daemon. */
async function dockerEndpoint(): Promise<string | null> {
  const r = await execa(
    "docker",
    ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"],
    { reject: false }
  );
  const out = r.exitCode === 0 ? r.stdout.trim() : "";
  return out || null;
}

function readDefaultSocketLink(): string | null {
  try {
    return readlinkSync(DEFAULT_SOCKET);
  } catch {
    return null;
  }
}

/**
 * False when the runtime is unknown, the start is off, or the developer
 * declines; throws when the start command fails or the runtime never answers.
 * The runtime keeps running after crbn exits: other worktrees share it.
 */
export async function startLocalDocker(
  responds: (timeoutMs: number) => Promise<boolean>
): Promise<boolean> {
  const mode = dockerStartMode(process.env, process.stdin.isTTY === true);
  if (mode === "off") return false;
  const runtime = dockerRuntime(
    await dockerEndpoint(),
    process.platform,
    readDefaultSocketLink()
  );
  if (!runtime) return false;

  if (mode === "ask") {
    const ok = await confirm({
      message: `Docker isn't running. Start ${runtime.name} now?`,
      initialValue: true
    });
    if (isCancel(ok)) abort();
    if (!ok) return false;
  } else {
    log.info(
      `Docker isn't running — starting ${runtime.name} (CARBON_DOCKER_AUTOSTART=0 turns this off)`
    );
  }

  const command = [runtime.command, ...runtime.args].join(" ");
  // clack's spinner takes SIGINT and SIGTERM and only stops itself; without the
  // exit, a killed `crbn reset` would go on to its teardown once Docker answers.
  const s = spinner({ indicator: "timer", onCancel: () => process.exit(1) });
  s.start(`starting ${runtime.name}`);
  const deadline = Date.now() + DOCKER_START_TIMEOUT_MS;
  // `open` and `systemctl` return at once; `orbctl` and `colima` return once
  // the VM is up.
  const started = await execa(runtime.command, runtime.args, {
    reject: false,
    stdin: "ignore",
    timeout: DOCKER_START_TIMEOUT_MS
  });
  if (started.failed && !started.timedOut) {
    s.error(`${runtime.name} did not start`);
    const detail =
      started.stderr?.trim().split("\n")[0] ||
      (started.exitCode === undefined
        ? "it did not run"
        : `exit code ${started.exitCode}`);
    throw new Error(
      `\`${command}\` failed (${detail}). Start ${runtime.name} yourself and re-run.`
    );
  }
  // A `docker info` that hangs on a half-started engine is killed at the end.
  const end = Math.max(deadline, Date.now() + 5_000);
  const up = await waitUntil(() => responds(Math.max(end - Date.now(), 1)), {
    timeoutMs: end - Date.now(),
    intervalMs: 1000
  });
  if (!up) {
    s.error(`${runtime.name} is not answering`);
    throw new Error(
      `${runtime.name} did not answer within ${DOCKER_START_TIMEOUT_MS / 1000} s. Check it for a sign-in or update dialog, then re-run.`
    );
  }
  s.stop(`${runtime.name} is running`);
  return true;
}
