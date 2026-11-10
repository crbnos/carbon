// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { DocumentBlockType } from "../../../template";
import { salesReturnOrderTexts } from "../../../template";
import { CustomFieldBlock } from "../CustomFieldBlock";
import { extensionBlocks } from "../extensionRegistry";
import { ReturnOrderLineItems } from "../returnOrder/LineItemsBlock";
import { ReturnOrderParties } from "../returnOrder/PartiesBlock";
import { DocumentNotes, DocumentTerms } from "../standardBlocks";
import { HeaderBlock } from "./HeaderBlock";
import type { BlockRenderer } from "./types";

/** Block-type → renderer for the Sales Return Order (RMA). */
export const salesReturnOrderBlockRegistry: Partial<
  Record<DocumentBlockType, BlockRenderer>
> = {
  ...extensionBlocks,
  header: ({ data }) => <HeaderBlock data={data} />,
  parties: ({ block, data }) => (
    <ReturnOrderParties
      block={block}
      texts={salesReturnOrderTexts.parties}
      vars={data.vars}
      party="customer"
      partyHeading="customer"
      details={["rmaNumber", "date", "expires", "customerRef"]}
      otherAddress="returnTo"
    />
  ),
  notes: ({ block, data }) => (
    <DocumentNotes
      block={block}
      texts={salesReturnOrderTexts.notes}
      notes={data.salesReturnOrder?.externalNotes}
      vars={data.vars}
    />
  ),
  lineItems: ({ block, data }) =>
    block.type === "lineItems" ? (
      <ReturnOrderLineItems
        block={block}
        texts={salesReturnOrderTexts.lineItems}
        lines={data.salesReturnOrderLines}
        data={data}
      />
    ) : null,
  terms: ({ block, data }) =>
    block.type === "terms" ? (
      <DocumentTerms
        block={block}
        texts={salesReturnOrderTexts.terms}
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
          (data.salesReturnOrder?.customFields ?? {}) as Record<string, unknown>
        }
      />
    ) : null
};
