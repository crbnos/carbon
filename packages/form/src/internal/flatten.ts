// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { setPath } from "../utils";
import { MultiValueMap } from "./MultiValueMap";

export const objectFromPathEntries = (entries: [string, any][]) => {
  const map = new MultiValueMap<string, any>();
  // biome-ignore lint/suspicious/useIterableCallbackReturn: suppressed due to migration
  entries.forEach(([key, value]) => map.add(key, value));
  return [...map.entries()].reduce(
    (acc, [key, value]) =>
      setPath(acc, key, value.length === 1 ? value[0] : value),
    {} as Record<string, any>
  );
};
