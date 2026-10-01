// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { changelog, docs, guide } from "collections/server";
import { loader } from "fumadocs-core/source";

export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
});

export const guideSource = loader({
  baseUrl: "/guides",
  source: guide.toFumadocsSource(),
});

export const changelogSource = loader({
  baseUrl: "/changelog",
  source: changelog.toFumadocsSource(),
});

// Newest first by frontmatter `date`; filename order breaks ties.
export function getChangelogEntries() {
  return [...changelogSource.getPages()].sort((a, b) =>
    b.data.date.localeCompare(a.data.date)
  );
}
