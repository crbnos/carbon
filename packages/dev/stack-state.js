// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The files through which `crbn up` and the dev servers it runs share a
// stack's state (hibernation, a cloud boot). Plain JS: the Vite plugin
// (vite.js) imports it as well as the CLI.

import fs from "node:fs";
import path from "node:path";

/** The env var that hands a dev server its stack's state directory. */
export const STACK_STATE_ENV = "CRBN_STACK_STATE";

/** Touched by every request; its mtime is the stack's last activity. */
export const activityFile = (dir) => path.join(dir, "activity");

/** Exists while the containers are stopped; holds the pid of the `crbn up`
 *  that will wake them. */
export const asleepFile = (dir) => path.join(dir, "asleep");

/** Exists while a cloud boot's early dev servers wait for the database;
 *  holds the pid of the `crbn up` that is preparing it. */
export const bootingFile = (dir) => path.join(dir, "booting");

/** Exists while a `crbn up` supervises this stack; holds its pid, so
 *  `crbn down` from another shell can stop it. */
export const upFile = (dir) => path.join(dir, "up");

/** How long a request waits for a wake. */
export const WAKE_TIMEOUT_MS = 120_000;

/** How long a request waits for a cloud boot; a fresh volume takes minutes. */
export const BOOT_TIMEOUT_MS = 600_000;

/** True when scripts/cloud-dev.sh started this process in a cloud container. */
export function isCloudDev() {
  return process.env.CARBON_DEV_CLOUD === "1";
}

/** The stack is asleep and a live `crbn up` will wake it. */
export const isAsleepIn = (dir) => livePid(asleepFile(dir)) !== null;

/** A live `crbn up` is still preparing the database. */
export const isBootingIn = (dir) => livePid(bootingFile(dir)) !== null;

/** The pid a marker holds, while that process lives. A marker whose
 *  `crbn up` was killed is removed: nobody would ever act on it. */
export function livePid(marker) {
  let pid;
  try {
    pid = Number(fs.readFileSync(marker, "utf8"));
  } catch {
    return null;
  }
  // 0 or less would signal a process group, which always answers.
  if (!Number.isInteger(pid) || pid <= 0) {
    fs.rmSync(marker, { force: true });
    return null;
  }
  try {
    process.kill(pid, 0);
    return pid;
  } catch (err) {
    // EPERM: alive, owned by another user.
    if (err.code === "EPERM") return pid;
    fs.rmSync(marker, { force: true });
    return null;
  }
}
