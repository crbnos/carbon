import type { DocumentBlockType } from "../../../template";
import { CustomFieldBlock } from "../CustomFieldBlock";
import { extensionBlocks } from "../extensionRegistry";
import { DetailsBlock } from "./DetailsBlock";
import { HeaderBlock } from "./HeaderBlock";
import { LineItemsBlock } from "./LineItemsBlock";
import { NotesBlock } from "./NotesBlock";
import { PartiesBlock } from "./PartiesBlock";
import { TermsBlock } from "./TermsBlock";
import type { BlockRenderer } from "./types";

/** Block-type → renderer for Packing Slip (fulfillment; no summary/pricing). */
export const packingSlipBlockRegistry: Partial<
  Record<DocumentBlockType, BlockRenderer>
> = {
  ...extensionBlocks,
  header: ({ data }) => <HeaderBlock data={data} />,
  parties: ({ data }) => <PartiesBlock data={data} />,
  notes: ({ data }) => <NotesBlock data={data} />,
  details: ({ data }) => <DetailsBlock data={data} />,
  lineItems: ({ block, data }) =>
    block.type === "lineItems" ? (
      <LineItemsBlock block={block} data={data} />
    ) : null,
  terms: ({ block, data }) =>
    block.type === "terms" ? <TermsBlock block={block} data={data} /> : null,
  customField: ({ block, data }) =>
    block.type === "customField" ? (
      <CustomFieldBlock
        block={block}
        customFields={
          (data.shipment?.customFields ?? {}) as Record<string, unknown>
        }
      />
    ) : null
};
