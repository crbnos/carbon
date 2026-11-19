// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { renderToBuffer } from "@react-pdf/renderer";
import { createElement, type ReactElement } from "react";
import { extractText } from "unpdf";
import { describe, expect, it } from "vitest";
import {
  allMergeFields,
  applyDocumentEdit,
  collectValues,
  type DocumentTemplateType,
  getTextEntries,
  isEditableValue,
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

  /** Everything a document prints, with the given props on top of its sample. */
  async function printed(
    documentType: DocumentTemplateType,
    props: Record<string, unknown> = {}
  ) {
    const { Component, sample } = DOCUMENT_PDFS[documentType];
    const pdf = await renderToBuffer(
      createElement(Component, {
        locale: "en-US",
        ...sample,
        ...props
      }) as ReactElement
    );
    const { text } = await extractText(new Uint8Array(pdf));
    return text.join(" ");
  }

  const pageDocuments = documentTypes.filter(
    (documentType) => documentType !== "trackingLabel"
  );

  /** What makes each document print the tables its sample leaves out. */
  const everyTable: Partial<
    Record<DocumentTemplateType, (sample: any) => Record<string, unknown>>
  > = {
    // A delivery ticket prints its units instead of the shipment's lines, which
    // the plain slip's table already covers below.
    packingSlip: () => ({
      documentType: "deliveryTicket",
      rentalUnits: [
        {
          id: "unit-1",
          name: "Flight unit",
          assetReadableId: "FU-1",
          serialNumber: "SN-9",
          quantity: "3 EA"
        }
      ]
    }),
    quote: (sample) => ({
      quoteLines: sample.quoteLines.map((line: any, index: number) =>
        index === 0
          ? {
              ...line,
              additionalCharges: {
                freight: {
                  description: "Crating",
                  amounts: { [line.quantity[0]]: 5 }
                }
              }
            }
          : line
      )
    }),
    jobTraveler: (sample) => ({
      includeMaterials: true,
      materials: [
        {
          id: "material-1",
          itemReadableId: "BOLT-9",
          description: "Bolt",
          quantity: 4,
          unitOfMeasureCode: "EA"
        }
      ],
      jobOperations: sample.jobOperations.map(
        (operation: any, index: number) =>
          index === 0
            ? {
                ...operation,
                jobOperationStep: [
                  { id: "step-1", sortOrder: 1, name: "Check torque" }
                ]
              }
            : operation
      )
    }),
    issue: (sample) => ({
      jobOperationStepRecords: [
        {
          name: "Check finish",
          operationId: "operation-1",
          nonConformanceActionId: sample.actionTasks[0].id,
          jobOperationStepRecord: [
            {
              id: "record-1",
              booleanValue: true,
              createdBy: "user-1",
              createdAt: "2026-06-01T00:00:00Z"
            }
          ]
        }
      ]
    })
  };
  const propsWithEveryTable = (documentType: DocumentTemplateType) =>
    everyTable[documentType]?.(DOCUMENT_PDFS[documentType].sample) ?? {};

  /** The template with whatever option a table prints behind switched on. */
  function templateWithEveryTable(documentType: DocumentTemplateType) {
    const template = resolveTemplate(documentType, null);
    return {
      ...template,
      blocks: template.blocks.map((block) =>
        block.type === "operations"
          ? { ...block, showWorkInstructions: true }
          : block
      )
    };
  }

  // Deleting a driver's `values.document` or any table's `values.row` fails here.
  it.each(pageDocuments)(
    "prints the %s values one document changed, in every table",
    async (documentType) => {
      const editable = new Set(
        allMergeFields(documentType)
          .filter(isEditableValue)
          .map((field) => field.token)
      );
      const template = templateWithEveryTable(documentType);
      const catalogRows = new Set(
        ["document" as const, ...template.blocks.map((block) => block.type)]
          .flatMap((type) => getTextEntries(documentType, type))
          .flatMap((entry) => (entry.row ? [entry.row] : []))
      );
      const printedRows = new Set<string>();

      for (const props of [{}, propsWithEveryTable(documentType)]) {
        const { collector, collected } = collectValues();
        const original = await printed(documentType, {
          ...props,
          template,
          valueCollector: collector
        });
        const prints = (value: string | undefined) =>
          Boolean(value && value.length > 2 && original.includes(value));
        const documentToken = Object.keys(collected.document).find(
          (token) => editable.has(token) && prints(collected.document[token])
        );
        expect(documentToken).toBeDefined();
        for (const row of collected.rows) printedRows.add(row.prefix);

        // Every row: one table can print from two places (an issue's associations).
        const rowEdits = collected.rows.flatMap((row, index) => {
          const token = Object.keys(row.values).find(
            (candidate) =>
              editable.has(candidate) && prints(row.values[candidate])
          );
          return token
            ? [{ key: row.key, token, marker: `Z${row.prefix}${index}Z` }]
            : [];
        });
        const words = await printed(documentType, {
          ...props,
          template: {
            ...template,
            settings: {
              ...template.settings,
              valueEdits: {
                document: { [documentToken as string]: "Zdocument" },
                rows: Object.fromEntries(
                  rowEdits.map(({ key, token, marker }) => [
                    key,
                    { [token]: marker }
                  ])
                )
              }
            }
          }
        });
        const page = words.replace(/\s+/g, "");
        expect(page).toContain("Zdocument");
        for (const { marker } of rowEdits) expect(page).toContain(marker);
      }

      for (const prefix of catalogRows) {
        expect([...printedRows], `no ${prefix} row printed`).toContain(prefix);
      }
    },
    60000
  );

  // Every text gets a word of its own, and each must print. A block that prints a
  // literal instead shows up in this list, whatever the text's kind. What the list
  // holds today needs data no sample has: read it before updating it.
  it.each(pageDocuments)(
    "prints every text of the %s catalog it reaches",
    async (documentType) => {
      const template = templateWithEveryTable(documentType);
      let next = 0;
      const marked = (entries: readonly { key: string }[]) =>
        Object.fromEntries(
          entries.map((entry) => [entry.key, `Z${next++}Z`] as const)
        );
      const marks = new Map<string, string>();
      const remember = (scope: string, text: Record<string, string>) => {
        for (const [key, marker] of Object.entries(text)) {
          marks.set(`${scope}:${key}`, marker.toLowerCase());
        }
        return text;
      };
      const words = {
        ...template,
        blocks: template.blocks.map((block) => ({
          ...block,
          text: remember(
            block.id,
            marked(getTextEntries(documentType, block.type))
          )
        })),
        settings: {
          ...template.settings,
          text: remember(
            "document",
            marked(getTextEntries(documentType, "document"))
          )
        }
      };
      const page = (
        await Promise.all(
          [{}, propsWithEveryTable(documentType)].map((props) =>
            printed(documentType, { ...props, template: words })
          )
        )
      )
        .join(" ")
        .toLowerCase()
        .replace(/\s+/g, "");
      expect(
        [...marks]
          .filter(([, marker]) => !page.includes(marker))
          .map(([key]) => key)
      ).toMatchSnapshot();
    },
    60000
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

  it("prints a contract delivery as a Receiving Report", async () => {
    const { Component, sample } = DOCUMENT_PDFS.packingSlip;
    const pdf = await renderToBuffer(
      createElement(Component, {
        locale: "en-US",
        ...sample,
        documentType: "receivingReport",
        customerReference: "CONTRACT-1",
        rentalUnits: [
          {
            id: "1",
            name: "CLIN 0001 Flight unit",
            assetReadableId: "FU-1",
            serialNumber: "SN-9",
            quantity: "3 EA"
          }
        ]
      }) as ReactElement
    );
    const { text } = await extractText(new Uint8Array(pdf));
    const printed = text.join(" ");
    expect(printed).toContain("Receiving Report");
    expect(printed).toContain("Contract No.: CONTRACT-1");
    expect(printed).not.toContain("Customer PO #");
    expect(printed).toContain("3 EA");
  });

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
