// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export const nestedObjectToPathObject = (
  val: any,
  acc: Record<string, any>,
  path: string
): any => {
  if (Array.isArray(val)) {
    // biome-ignore lint/suspicious/useIterableCallbackReturn: suppressed due to migration
    val.forEach((v, index) =>
      nestedObjectToPathObject(v, acc, `${path}[${index}]`)
    );
    return acc;
  }

  if (typeof val === "object") {
    Object.entries(val).forEach(([key, value]) => {
      const nextPath = path ? `${path}.${key}` : key;
      nestedObjectToPathObject(value, acc, nextPath);
    });
    return acc;
  }

  if (val !== undefined) {
    acc[path] = val;
  }

  return acc;
};
