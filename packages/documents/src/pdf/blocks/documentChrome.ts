// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { JSONContent } from "@carbon/react";
import {
  DEFAULT_HEADER_OPTIONS,
  type DocumentTemplate,
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
  template: { settings, blocks, headerSectionId, footerSectionId },
  vars,
  sections
}: {
  texts: E;
  template: Pick<
    DocumentTemplate,
    "settings" | "blocks" | "headerSectionId" | "footerSectionId"
  >;
  vars: Record<string, string>;
  sections: Record<string, ResolvedSection>;
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
