// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { renderToBuffer } from "@react-pdf/renderer";
import { createElement, type ReactElement } from "react";
import { extractText } from "unpdf";
import { describe, expect, it } from "vitest";
import {
  applyDocumentEdit,
  type DocumentTemplateType,
  resolveTemplate
} from "../template";
import { DOCUMENT_PDFS } from "./preview-documents";

const documentTypes = Object.keys(DOCUMENT_PDFS) as DocumentTemplateType[];

describe("DOCUMENT_PDFS", () => {
  // Every word a document prints, so a refactor that loses a value, changes a
  // format or moves a label fails here. Update the snapshot only for a change
  // to what a document should print.
  it.each(documentTypes)(
    "prints the %s sample",
    async (documentType) => {
      const { Component, sample } = DOCUMENT_PDFS[documentType];
      const pdf = await renderToBuffer(
        createElement(Component, { locale: "en-US", ...sample }) as ReactElement
      );
      const { text } = await extractText(new Uint8Array(pdf));
      expect(text).toMatchSnapshot();
    },
    30000
  );

  const documentsWithNotes = documentTypes.filter((documentType) =>
    resolveTemplate(documentType, null).blocks.some(
      (block) => block.type === "notes" && block.visible
    )
  );
  it.each(documentsWithNotes)(
    "prints the %s draft's unsaved notes",
    async (documentType) => {
      const { Component, sample } = DOCUMENT_PDFS[documentType];
      const template = applyDocumentEdit(resolveTemplate(documentType, null), {
        blocks: {},
        settings: {},
        notes: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Unsaved draft note" }]
            }
          ]
        }
      });
      const pdf = await renderToBuffer(
        createElement(Component, {
          locale: "en-US",
          ...sample,
          template
        }) as ReactElement
      );
      const { text } = await extractText(new Uint8Array(pdf));
      expect(text.join(" ")).toContain("Unsaved draft note");
    },
    30000
  );

  it("leaves a hidden column out of the table", async () => {
    const { Component, sample } = DOCUMENT_PDFS.purchaseOrder;
    const template = resolveTemplate("purchaseOrder", null);
    const pdf = await renderToBuffer(
      createElement(Component, {
        locale: "en-US",
        ...sample,
        template: {
          ...template,
          blocks: template.blocks.map((block) =>
            block.type === "lineItems"
              ? { ...block, hidden: ["unitPrice"] }
              : block
          )
        }
      }) as ReactElement
    );
    const { text } = await extractText(new Uint8Array(pdf));
    expect(text.join(" ")).not.toContain("Unit Price");
    expect(text.join(" ")).toContain("Qty");
  });
});
