// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATES } from "../defaults";
import { isEditableValue } from "../merge";
import { getLineMergeFields, getMergeFields } from "../mergeFields";
import type {
  DocumentBlock,
  DocumentTemplate,
  DocumentTemplateType
} from "../schema";
import { DEFAULT_DOCUMENT_SETTINGS } from "../schema";
import { TEXT_CATALOG } from "./index";
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
  const withWords = (blockType: string, text: Record<string, string>) => ({
    ...template([]),
    blocks: po.blocks.map((block) =>
      block.type === blockType ? { ...block, text } : block
    )
  });

  it("refuses a change to an amount or a quantity, not to other values", () => {
    const changed = (rows: Record<string, string>) =>
      validateTemplateText(
        template([], { valueEdits: { rows: { "line:a": rows } } })
      );
    expect(changed({ "line.unitPrice": "1.00" })).toMatchObject([
      { code: "valueLocked", token: "line.unitPrice" }
    ]);
    expect(changed({ "line.quantity": "9" })).toMatchObject([
      { code: "valueLocked", token: "line.quantity" }
    ]);
    expect(changed({ "line.details": "Smallsat Bus Loaner" })).toEqual([]);
    expect(
      validateTemplateText(
        template([], { valueEdits: { document: { "order.total": "1.00" } } })
      )
    ).toMatchObject([{ code: "valueLocked", token: "order.total" }]);
  });

  it("refuses a typed figure in place of an amount", () => {
    expect(
      validateTemplateText(withWords("summary", { totalValue: "1,000.00" }))
    ).toMatchObject([
      { code: "amountRemoved", field: "totalValue", token: "order.total" }
    ]);
    expect(
      validateTemplateText(withWords("lineItems", { unitPriceCell: "" }))
    ).toMatchObject([{ code: "amountRemoved", token: "line.unitPrice" }]);
  });

  it("takes words around an amount, and other values changed freely", () => {
    expect(
      validateTemplateText(
        withWords("summary", { totalValue: "{order.total} due" })
      )
    ).toEqual([]);
    expect(
      validateTemplateText(withWords("parties", { date: "Issued today" }))
    ).toEqual([]);
  });

  it("refuses a number typed against a figure, which would change what it says", () => {
    for (const qtyCell of [
      "1{line.quantity}",
      "{line.quantity}0",
      "1.{line.quantity}",
      "{line.quantity},5",
      "{line.quantity}{line.quantity}",
      "{line.number}{line.quantity}",
      "{line.quantity} 000",
      "{line.quantity}.     000",
      "1 {line.quantity}",
      "1.,{line.quantity}",
      "١{line.quantity}",
      "½{line.quantity}",
      "1\u200B{line.quantity}",
      "{line.number} {line.quantity}",
      "{line.quantity} {line.quantity}",
      "1 {line.details} {line.quantity}",
      "1-{line.quantity}",
      "-{line.quantity}",
      "({line.quantity})",
      "{line.quantity}k"
    ]) {
      expect(
        validateTemplateText(withWords("lineItems", { qtyCell })),
        qtyCell
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "amountChanged",
            token: "line.quantity"
          })
        ])
      );
    }
    expect(
      validateTemplateText(
        withWords("lineItems", { qtyCell: "x {line.quantity} pcs" })
      )
    ).toEqual([]);
    expect(
      validateTemplateText(
        withWords("lineItems", { qtyCell: "{line.quantity} of 5" })
      )
    ).toEqual([]);
    expect(
      validateTemplateText(
        withWords("lineItems", { qtyCell: "{line.quantity}{line.unit}" })
      )
    ).toEqual([]);
  });

  it("refuses a number against a figure in a block's own fields", () => {
    const rows = (value: string) => ({
      documentType: "salesOrder" as const,
      blocks: [
        {
          id: "kv",
          type: "keyValue" as const,
          visible: true,
          rows: [{ label: "Total", value }]
        }
      ],
      settings: {}
    });
    expect(validateTemplateText(rows("1{order.total}") as never)).toMatchObject(
      [{ code: "amountChanged", blockId: "kv", field: "rows.0.value" }]
    );
    expect(validateTemplateText(rows("Total {order.total}") as never)).toEqual(
      []
    );
  });

  it("refuses no default text", () => {
    for (const [documentType, catalog] of Object.entries(TEXT_CATALOG)) {
      for (const [blockType, entries] of Object.entries(catalog)) {
        const text = Object.fromEntries(
          (entries ?? []).map((entry) => [entry.key, entry.default])
        );
        const template = {
          documentType: documentType as DocumentTemplateType,
          blocks:
            blockType === "document"
              ? []
              : [
                  {
                    id: blockType,
                    type: blockType,
                    visible: true,
                    text
                  } as DocumentBlock
                ],
          settings: {
            ...DEFAULT_DOCUMENT_SETTINGS,
            ...(blockType === "document" ? { text } : {})
          }
        };
        expect(validateTemplateText(template), blockType).toEqual([]);
      }
    }
  });

  it("lets a user hide an amount's column", () => {
    const hidden = {
      ...template([]),
      blocks: po.blocks.map((block) =>
        block.type === "lineItems" ? { ...block, hidden: ["unitPrice"] } : block
      )
    };
    expect(validateTemplateText(hidden)).toEqual([]);
  });

  it("protects a money value in every document that prints one", () => {
    for (const [documentType, catalog] of Object.entries(TEXT_CATALOG)) {
      const defaults = Object.values(catalog)
        .flatMap((entries) => [...(entries ?? [])])
        .map((entry) => entry.default)
        .join(" ");
      const amounts = [
        ...getMergeFields(documentType),
        ...getLineMergeFields(documentType)
      ].filter((field) => field.amount);
      for (const field of amounts) {
        expect(defaults, `${documentType} ${field.token}`).toContain(
          `{${field.token}}`
        );
      }
    }
  });
  it("refuses a typed number in place of a quantity, in a block or the document's texts", () => {
    expect(
      validateTemplateText(withWords("lineItems", { qtyCell: "999999" }))
    ).toMatchObject([
      { code: "amountRemoved", field: "qtyCell", token: "line.quantity" }
    ]);
    const traveler = DEFAULT_TEMPLATES.jobTraveler;
    expect(
      validateTemplateText({
        documentType: traveler.documentType,
        blocks: traveler.blocks,
        settings: {
          ...traveler.settings,
          text: { materialsQuantityCell: "999999" }
        }
      })
    ).toMatchObject([
      {
        blockId: "document",
        code: "amountRemoved",
        field: "materialsQuantityCell"
      }
    ]);
  });

  describe("flags on every page document's variables", () => {
    const documents = Object.keys(TEXT_CATALOG).filter(
      (type) => type !== "trackingLabel"
    );
    const fields = documents.flatMap((type) =>
      [...getMergeFields(type), ...getLineMergeFields(type)].map((field) => ({
        ...field,
        type,
        name: field.token.split(".")[1] ?? ""
      }))
    );

    it("makes every figure one a text must keep", () => {
      const figure =
        /^(total|subtotal|tax|taxAmount|taxAndFees|fees|shipping|addOns?|nonTaxableAddOn|discount|unitPrice|netValue|amount|.*[qQ]uantity)$/;
      for (const field of fields.filter((f) => figure.test(f.name))) {
        expect(field.amount, `${field.type} ${field.token}`).toBe(true);
      }
    });

    it("locks what identifies the record or must agree with a figure", () => {
      const locked = /^(number|revision|currency|unit|.*[pP]ercent)$/;
      for (const field of fields.filter((f) => locked.test(f.name))) {
        expect(isEditableValue(field), `${field.type} ${field.token}`).toBe(
          false
        );
      }
    });

    it("locks what differs per page of a job traveler", () => {
      const perPage = [
        "job.methodRevision",
        "job.batchNumber",
        "item.readableId",
        "item.name",
        "item.trackingType"
      ];
      for (const token of perPage) {
        const field = getMergeFields("jobTraveler").find(
          (f) => f.token === token
        );
        expect(field && isEditableValue(field), token).toBe(false);
      }
    });
  });

  it("takes a table row's variable only in a text printed per row", () => {
    const withText = (blockType: string, text: Record<string, string>) => ({
      ...template([]),
      blocks: po.blocks.map((block) =>
        block.type === blockType ? { ...block, text } : block
      )
    });
    expect(
      validateTemplateText(
        withText("lineItems", { qtyCell: "{line.quantity} {line.unit}" })
      )
    ).toEqual([]);
    expect(
      validateTemplateText(withText("parties", { date: "{line.quantity}" }))
    ).toMatchObject([{ code: "unknownVariable", token: "line.quantity" }]);
  });

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
