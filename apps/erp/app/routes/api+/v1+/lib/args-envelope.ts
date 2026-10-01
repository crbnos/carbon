// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ManifestEntry } from "@carbon/api";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function unwrapArgsEnvelope(
  meta: Pick<ManifestEntry, "schema">,
  args?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!args) return args;
  const properties = meta.schema.properties;
  if (isPlainObject(properties) && "args" in properties) return args;
  const keys = Object.keys(args);
  if (keys.length !== 1 || keys[0] !== "args") return args;
  return isPlainObject(args.args) ? args.args : args;
}
