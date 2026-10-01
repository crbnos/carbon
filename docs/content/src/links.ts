// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export const DOCS_URL = "https://docs.carbon.ms";

/** Public URL for a docs path, e.g. `docs/reference/jobs` or `/docs/reference/jobs#fields`. */
export function docUrl(path: string): string {
  return `${DOCS_URL}/${path.replace(/^\/+/, "")}`;
}
