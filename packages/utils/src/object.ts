// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Group an array by a key derived from each item. Indexed loop and a
 * `result[key] === undefined` check keep the hot path off `.reduce`'s
 * closure allocation and avoid the implicit `in` lookup of `!result[key]`
 * (which also misbehaves on items that happen to map to the falsy keys
 * `""` / `0`).
 */
export const groupBy = <T, K extends keyof any>(
  array: T[],
  getKey: (item: T) => K
): Record<K, T[]> => {
  const result = {} as Record<K, T[]>;
  const len = array.length;
  for (let i = 0; i < len; i++) {
    const item = array[i]!;
    const key = getKey(item);
    const bucket = result[key];
    if (bucket === undefined) {
      result[key] = [item];
    } else {
      bucket.push(item);
    }
  }
  return result;
};

export const pick = <T extends Record<string, any>, K extends keyof T>(
  obj: T,
  keys: K[]
): Pick<T, K> => {
  const result = {} as Pick<T, K>;
  const len = keys.length;
  for (let i = 0; i < len; i++) {
    const key = keys[i]!;
    if (key in obj) {
      result[key] = obj[key];
    }
  }
  return result;
};

export const get = <T extends Record<string, any>, K extends keyof T>(
  obj: T,
  key: K,
  defaultValue: T[K]
): T[K] => {
  const value = obj[key];
  return value === undefined ? defaultValue : value;
};
