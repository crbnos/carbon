// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Minimal isomorphic env reader for the logging package only.
 *
 * `@carbon/logger` deliberately does NOT depend on `@carbon/env`: that module
 * throws at load time when a required var is missing, which would make the
 * logger un-importable in bare contexts (tests, scripts, edge). Logging must be
 * a true leaf. We read the two non-secret vars we need directly.
 */
type EnvName = "LOG_LEVEL" | "NODE_ENV";

export function readEnv(name: EnvName): string | undefined {
  if (typeof document !== "undefined") {
    return (globalThis as { window?: { env?: Record<string, string> } }).window
      ?.env?.[name];
  }
  return typeof process !== "undefined" ? process.env?.[name] : undefined;
}
