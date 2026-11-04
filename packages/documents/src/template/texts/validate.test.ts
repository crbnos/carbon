// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATES } from "../defaults";
import type { DocumentBlock, DocumentTemplate } from "../schema";
import { unknownVariables, validateTemplateText } from "./validate";

const po = DEFAULT_TEMPLATES.purchaseOrder;

function template(
  extraBlocks: DocumentBlock[],
  settings: Partial<DocumentTemplate["settings"]> = {}
) {
  return {
    documentType: po.documentType,
    blocks: [...po.blocks, ...extraBlocks],
    settings: { ...po.settings, ...settings }
  };
}

const field = (value: string): DocumentBlock => ({
  id: "f1",
  type: "field",
  visible: true,
  value
});

describe("validateTemplateText", () => {
  it("accepts the default template", () => {
    expect(validateTemplateText(template([]))).toEqual([]);
  });

  it("accepts a variable the document type offers", () => {
    expect(
      validateTemplateText(template([field("PO {order.number}")]))
    ).toEqual([]);
  });

  it("refuses a variable the document type does not offer", () => {
    expect(validateTemplateText(template([field("{order.totl}")]))).toEqual([
      {
        blockId: "f1",
        field: "value",
        code: "unknownVariable",
        token: "order.totl",
        message: "Field › Value: unknown variable {order.totl}"
      }
    ]);
  });

  it("refuses an unknown variable inside rich text", () => {
    const rich: DocumentBlock = {
      id: "r1",
      type: "richText",
      visible: true,
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "{nope}" }] }
        ]
      }
    };
    expect(validateTemplateText(template([rich])).map((p) => p.field)).toEqual([
      "content"
    ]);
  });

  it("refuses a text key the catalog does not have", () => {
    const block = { ...field("x"), text: { madeUp: "Hi" } };
    expect(validateTemplateText(template([block]))).toEqual([
      {
        blockId: "f1",
        field: "madeUp",
        code: "unknownText",
        message: "Field › madeUp: unknown text"
      }
    ]);
  });

  it("refuses hiding a key the block cannot hide", () => {
    const block = { ...field("x"), hidden: ["madeUp"] };
    expect(
      validateTemplateText(template([block])).map((p) => p.message)
    ).toEqual(["Field › madeUp: cannot be hidden"]);
  });

  it("accepts a changed text and a hidden field from the catalog", () => {
    const parties = po.blocks.find((b) => b.type === "parties")!;
    const changed = {
      ...parties,
      text: { supplierTaxId: "GST No.:" },
      hidden: ["supplierEori"]
    };
    expect(
      validateTemplateText({
        ...template([]),
        blocks: po.blocks.map((b) => (b.id === parties.id ? changed : b))
      })
    ).toEqual([]);
  });

  it("refuses hiding a heading", () => {
    const parties = po.blocks.find((b) => b.type === "parties")!;
    const changed = { ...parties, hidden: ["supplier"] };
    expect(
      validateTemplateText({
        ...template([]),
        blocks: po.blocks.map((b) => (b.id === parties.id ? changed : b))
      }).map((p) => p.field)
    ).toEqual(["supplier"]);
  });

  it("refuses an unknown document text in settings", () => {
    expect(
      validateTemplateText(template([], { text: { madeUp: "Hi" } })).map(
        (p) => p.blockId
      )
    ).toEqual(["document"]);
  });
});

describe("unknownVariables", () => {
  it("lists only the variables the list does not offer", () => {
    expect(
      unknownVariables("{company.name} {company.nope}", ["company.name"])
    ).toEqual(["company.nope"]);
  });
});
