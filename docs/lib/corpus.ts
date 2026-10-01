// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type CorpusPage, parsePage } from "@carbon/content/corpus";
import { guideSource, source } from "@/lib/source";

/** Every docs + guide page as stripped markdown, in file-path order. */
export async function getCorpus(): Promise<CorpusPage[]> {
  const pages = [
    ...source.getPages().map((page) => ({ file: `docs/${page.path}`, page })),
    ...guideSource
      .getPages()
      .map((page) => ({ file: `guides/${page.path}`, page })),
  ].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return Promise.all(
    pages.map(async ({ file, page }) =>
      parsePage(file.replace(/\.mdx$/, ""), await page.data.getText("raw"))
    )
  );
}
