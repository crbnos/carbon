// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { DocumentBlockType } from "../../../template";
import { CustomFieldBlock } from "../CustomFieldBlock";
import { extensionBlocks } from "../extensionRegistry";
import { HeaderBlock } from "./HeaderBlock";
import { LineItemsBlock } from "./LineItemsBlock";
import { NotesBlock } from "./NotesBlock";
import { PartiesBlock } from "./PartiesBlock";
import { SummaryBlock } from "./SummaryBlock";
import { TermsBlock } from "./TermsBlock";
import type { BlockRenderer } from "./types";

/** Block-type → renderer for Purchase Order. Extension blocks are shared. */
export const purchaseOrderBlockRegistry: Partial<
  Record<DocumentBlockType, BlockRenderer>
> = {
  ...extensionBlocks,
  header: ({ data }) => <HeaderBlock data={data} />,
  parties: ({ data }) => <PartiesBlock data={data} />,
  notes: ({ data }) => <NotesBlock data={data} />,
  lineItems: ({ block, data }) =>
    block.type === "lineItems" ? (
      <LineItemsBlock block={block} data={data} />
    ) : null,
  summary: ({ block, data }) =>
    block.type === "summary" ? (
      <SummaryBlock block={block} data={data} />
    ) : null,
  terms: ({ block, data }) =>
    block.type === "terms" ? <TermsBlock block={block} data={data} /> : null,
  customField: ({ block, data }) =>
    block.type === "customField" ? (
      <CustomFieldBlock
        block={block}
        customFields={
          (data.purchaseOrder?.customFields ?? {}) as Record<string, unknown>
        }
      />
    ) : null
};
