// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export function sanitize<T extends Record<string, any>>(
  input: T
): {
  [K in keyof T]: T[K] extends undefined ? null : T[K];
} {
  const output = { ...input } as {
    [K in keyof T]: T[K] extends undefined ? null : T[K];
  };
  Object.keys(output).forEach((key) => {
    if (output[key as keyof T] === undefined && key !== "id") {
      output[key as keyof T] = null as any;
    }
  });
  return output;
}
