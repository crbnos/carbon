import type { DocumentBlockType } from "../../template";
import { Watermark } from "../components";
import { CustomFieldBlock } from "./CustomFieldBlock";
import { HeaderBlock } from "./HeaderBlock";
import { KeyValueBlock } from "./KeyValueBlock";
import { LineItemsBlock } from "./LineItemsBlock";
import { NotesBlock } from "./NotesBlock";
import { PartiesBlock } from "./PartiesBlock";
import { RichTextBlock } from "./RichTextBlock";
import { SharedBlock } from "./SharedBlock";
import { SpacerBlock } from "./SpacerBlock";
import { SummaryBlock } from "./SummaryBlock";
import { TermsBlock } from "./TermsBlock";
import type { BlockRenderer, SalesInvoiceData } from "./types";

/**
 * Maps each block type to its react-pdf renderer. Built-in renderers read
 * from `data`; extension renderers narrow `block` by its discriminant. The
 * driver looks up by `block.type` — an O(1) Map lookup per block.
 */
export const salesInvoiceBlockRegistry: Record<
  DocumentBlockType,
  BlockRenderer<SalesInvoiceData>
> = {
  header: ({ data }) => <HeaderBlock data={data} />,
  watermark: ({ block, data }) =>
    block.type === "watermark" ? (
      <Watermark
        src={data.company.logoWatermark}
        show
        opacity={block.opacity}
        placement={block.placement}
        size={block.size}
      />
    ) : null,
  parties: ({ data }) => <PartiesBlock data={data} />,
  notes: ({ data }) => <NotesBlock data={data} />,
  details: () => null,
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
  jobDetails: () => null,
  operations: () => null,
  issueDetails: () => null,
  associations: () => null,
  actionTasks: () => null,
  reviewers: () => null,
  labelHeading: () => null,
  labelRevision: () => null,
  labelQuantity: () => null,
  labelTracking: () => null,
  labelEntityId: () => null,
  richText: ({ block, data }) =>
    block.type === "richText" ? (
      <RichTextBlock block={block} vars={data.vars} />
    ) : null,
  keyValue: ({ block, data }) =>
    block.type === "keyValue" ? (
      <KeyValueBlock block={block} vars={data.vars} />
    ) : null,
  spacer: ({ block }) =>
    block.type === "spacer" ? <SpacerBlock block={block} /> : null,
  shared: ({ block, data }) =>
    block.type === "shared" ? (
      <SharedBlock block={block} sections={data.sections} vars={data.vars} />
    ) : null,
  labelBarcode: () => null,
  labelLogo: () => null,
  field: () => null,
  customField: ({ block, data }) =>
    block.type === "customField" ? (
      <CustomFieldBlock
        block={block}
        customFields={
          (data.salesInvoice?.customFields ?? {}) as Record<string, unknown>
        }
      />
    ) : null
};
