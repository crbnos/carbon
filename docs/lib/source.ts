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

/** Changelog entries, newest first. `date` (frontmatter, YYYY-MM-DD) is the ordering
 *  key — filename order is only a tiebreaker via the stable sort. */
export function getChangelogEntries() {
  return [...changelogSource.getPages()].sort((a, b) =>
    b.data.date.localeCompare(a.data.date)
  );
}
