// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { DocumentBlockType } from "../../../template";
import { purchaseReturnOrderTexts } from "../../../template";
import { CustomFieldBlock } from "../CustomFieldBlock";
import { extensionBlocks } from "../extensionRegistry";
import { ReturnOrderLineItems } from "../returnOrder/LineItemsBlock";
import { ReturnOrderParties } from "../returnOrder/PartiesBlock";
import { DocumentNotes, DocumentTerms } from "../standardBlocks";
import { HeaderBlock } from "./HeaderBlock";
import type { BlockRenderer } from "./types";

/** Block-type → renderer for the Purchase Return Order (supplier return). */
export const purchaseReturnOrderBlockRegistry: Partial<
  Record<DocumentBlockType, BlockRenderer>
> = {
  ...extensionBlocks,
  header: ({ data }) => <HeaderBlock data={data} />,
  parties: ({ block, data }) => (
    <ReturnOrderParties
      block={block}
      texts={purchaseReturnOrderTexts.parties}
      vars={data.vars}
      party="supplier"
      partyHeading="returnTo"
      details={["returnNumber", "supplierRmaNumber", "date", "expires"]}
      otherAddress="shipFrom"
    />
  ),
  notes: ({ block, data }) => (
    <DocumentNotes
      block={block}
      texts={purchaseReturnOrderTexts.notes}
      notes={data.purchaseReturnOrder?.externalNotes}
      vars={data.vars}
    />
  ),
  lineItems: ({ block, data }) =>
    block.type === "lineItems" ? (
      <ReturnOrderLineItems
        block={block}
        texts={purchaseReturnOrderTexts.lineItems}
        lines={data.purchaseReturnOrderLines}
        data={data}
      />
    ) : null,
  terms: ({ block, data }) =>
    block.type === "terms" ? (
      <DocumentTerms
        block={block}
        texts={purchaseReturnOrderTexts.terms}
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
          (data.purchaseReturnOrder?.customFields ?? {}) as Record<
            string,
            unknown
          >
        }
      />
    ) : null
};
