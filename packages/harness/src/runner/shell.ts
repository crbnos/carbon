// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { execSync } from "node:child_process";
import type { Shell } from "./types";

const MAX_BUFFER = 64 * 1024 * 1024;

/** Real cwd-aware command runner. Never throws — failures come back as `ok: false`. */
export const shell: Shell = (cmd, opts) => {
  try {
    const output = execSync(cmd, {
      cwd: opts?.cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: MAX_BUFFER
    });
    return { ok: true, output };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
};

/** POSIX single-quote escape, safe for arbitrary content in a shell command. */
export function sq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
