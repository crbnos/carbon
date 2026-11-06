// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { DocumentBlockType } from "../../../template";
import { salesOrderTexts } from "../../../template";
import { CustomFieldBlock } from "../CustomFieldBlock";
import { DocumentSummary } from "../DocumentSummary";
import { extensionBlocks } from "../extensionRegistry";
import { DocumentNotes, DocumentTerms } from "../standardBlocks";
import { HeaderBlock } from "./HeaderBlock";
import { LineItemsBlock } from "./LineItemsBlock";
import { PartiesBlock } from "./PartiesBlock";
import type { BlockRenderer } from "./types";

/** Block-type → renderer for Sales Order. Extension blocks are shared. */
export const salesOrderBlockRegistry: Partial<
  Record<DocumentBlockType, BlockRenderer>
> = {
  ...extensionBlocks,
  header: ({ data }) => <HeaderBlock data={data} />,
  parties: ({ block, data }) => <PartiesBlock block={block} data={data} />,
  notes: ({ block, data }) => (
    <DocumentNotes
      block={block}
      texts={salesOrderTexts.notes}
      notes={data.salesOrder?.externalNotes}
      vars={data.vars}
    />
  ),
  lineItems: ({ block, data }) =>
    block.type === "lineItems" ? (
      <LineItemsBlock block={block} data={data} />
    ) : null,
  summary: ({ block, data }) =>
    block.type === "summary" ? (
      <DocumentSummary
        block={block}
        texts={salesOrderTexts.summary}
        vars={data.vars}
        currencyCode={data.currencyCode}
        rows={[
          { label: "subtotal", value: "subtotalValue", always: true },
          { label: "addOns", value: "addOnsValue" },
          { label: "shipping", value: "shippingValue" }
        ]}
      />
    ) : null,
  terms: ({ block, data }) =>
    block.type === "terms" ? (
      <DocumentTerms
        block={block}
        texts={salesOrderTexts.terms}
        terms={data.terms}
        vars={data.vars}
        accent={data.theme.accent}
      />
    ) : null,
  customField: ({ block, data }) =>
    block.type === "customField" ? (
      <CustomFieldBlock
        block={block}
        customFields={
          (data.salesOrder?.customFields ?? {}) as Record<string, unknown>
        }
      />
    ) : null
};
