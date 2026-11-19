// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Fragment, type ReactNode } from "react";
import type {
  DocumentBlock,
  DocumentBlockType,
  DocumentTemplate
} from "../../template";
import type { PDF } from "../../types";
import { Template } from "../components";
import type { documentChrome } from "./documentChrome";

type Chrome = Pick<
  ReturnType<typeof documentChrome>,
  | "documentTitle"
  | "footerText"
  | "headerContent"
  | "footerContent"
  | "showFooter"
  | "visibleBlocks"
>;

/** One block after another through the registry, or the page's own content. */
type Content<Data> =
  | {
      registry: Partial<
        Record<
          DocumentBlockType,
          (args: { block: DocumentBlock; data: Data }) => ReactNode
        >
      >;
      data: Data;
      children?: never;
    }
  | { registry?: never; data?: never; children: ReactNode };

/**
 * The page every document prints on: its PDF properties, its footer and each of
 * its visible blocks.
 */
export function DocumentPage<Data>({
  chrome,
  template: { theme, settings },
  meta,
  keywords,
  title = chrome.documentTitle,
  footerDocumentId,
  footerLabel,
  showRegistrationLine = settings.showRegistrationLine,
  registry,
  data,
  children
}: {
  chrome: Chrome;
  template: Pick<DocumentTemplate, "theme" | "settings">;
  meta?: PDF["meta"];
  keywords: string;
  title?: string;
  footerDocumentId?: string | null;
  footerLabel?: string;
  showRegistrationLine?: boolean;
} & Content<Data>) {
  return (
    <Template
      theme={theme}
      title={title}
      meta={{
        author: meta?.author ?? "Carbon",
        keywords: meta?.keywords ?? keywords,
        subject: meta?.subject ?? chrome.documentTitle
      }}
      footerDocumentId={footerDocumentId}
      footerLabel={footerLabel}
      showFooter={chrome.showFooter}
      showPageNumbers={settings.showPageNumbers}
      pageNumberFormat={settings.pageNumberFormat}
      showRegistrationLine={showRegistrationLine}
      fontFamily={settings.fontFamily}
      headerContent={chrome.headerContent}
      footerContent={chrome.footerContent}
      footerText={chrome.footerText}
    >
      {registry
        ? chrome.visibleBlocks.map((block) => {
            const render = registry[block.type];
            if (!render) return null;
            return (
              <Fragment key={block.id}>{render({ block, data })}</Fragment>
            );
          })
        : children}
    </Template>
  );
}
