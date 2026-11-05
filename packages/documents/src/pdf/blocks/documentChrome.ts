// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { JSONContent } from "@carbon/react";
import {
  DEFAULT_HEADER_OPTIONS,
  type DocumentBlock,
  type DocumentSettings,
  interpolateContent,
  makeText,
  type ResolvedSection,
  type TextEntry,
  type TextFn
} from "../../template";

/**
 * What every page document works out the same way from its template: its title
 * and number, the footer's words, its header and footer sections, and the blocks
 * that print.
 */
export function documentChrome<E extends readonly TextEntry[]>({
  texts,
  settings,
  vars,
  blocks,
  sections,
  headerSectionId,
  footerSectionId
}: {
  texts: E;
  settings: Pick<DocumentSettings, "text" | "hidden">;
  vars: Record<string, string>;
  blocks: DocumentBlock[];
  sections: Record<string, ResolvedSection>;
  headerSectionId: string | null | undefined;
  footerSectionId: string | null | undefined;
}) {
  // Every document's catalog has these words, so a wider key type is safe here.
  const words = makeText(texts as readonly TextEntry[], settings, vars);
  const dt = words as TextFn<E[number]["key"]>;
  const sectionContent = (id: string | null | undefined) => {
    const content = id ? sections[id]?.content : undefined;
    return content
      ? interpolateContent(content as JSONContent, vars)
      : undefined;
  };
  const showHeader = headerSectionId !== null;
  return {
    dt,
    documentTitle: words("title"),
    documentNumber: words.prints("documentNumber")
      ? words("documentNumber")
      : undefined,
    footerText: { pageLabel: words("page"), ofLabel: words("of") },
    headerOptions: {
      ...DEFAULT_HEADER_OPTIONS,
      ...(headerSectionId ? (sections[headerSectionId]?.config ?? {}) : {})
    },
    headerContent: sectionContent(headerSectionId),
    footerContent: sectionContent(footerSectionId),
    showFooter: footerSectionId !== null,
    visibleBlocks: blocks.filter(
      (block) => block.visible && !(block.type === "header" && !showHeader)
    )
  };
}
