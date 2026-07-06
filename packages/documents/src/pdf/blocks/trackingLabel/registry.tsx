import type { DocumentBlockType } from "../../../template";
import { CustomFieldBlock } from "../CustomFieldBlock";
import {
  LabelBarcodeBlock,
  LabelEntityIdBlock,
  LabelFieldBlock,
  LabelHeadingBlock,
  LabelLogoBlock,
  LabelQuantityBlock,
  LabelRevisionBlock,
  LabelTrackingBlock
} from "./LabelBlocks";
import type { BlockRenderer } from "./types";

/** Block-type → renderer for a tracking label (per-field elements). */
export const trackingLabelBlockRegistry: Record<
  DocumentBlockType,
  BlockRenderer
> = {
  labelHeading: ({ data }) => <LabelHeadingBlock data={data} />,
  labelRevision: ({ block, data }) =>
    block.type === "labelRevision" ? (
      <LabelRevisionBlock block={block} data={data} />
    ) : null,
  labelQuantity: ({ block, data }) =>
    block.type === "labelQuantity" ? (
      <LabelQuantityBlock block={block} data={data} />
    ) : null,
  labelTracking: ({ block, data }) =>
    block.type === "labelTracking" ? (
      <LabelTrackingBlock block={block} data={data} />
    ) : null,
  labelEntityId: ({ block, data }) =>
    block.type === "labelEntityId" ? (
      <LabelEntityIdBlock block={block} data={data} />
    ) : null,
  labelBarcode: ({ block, data }) =>
    block.type === "labelBarcode" ? (
      <LabelBarcodeBlock block={block} data={data} />
    ) : null,
  labelLogo: ({ block, data }) =>
    block.type === "labelLogo" ? (
      <LabelLogoBlock block={block} data={data} />
    ) : null,
  header: () => null,
  watermark: () => null,
  parties: () => null,
  notes: () => null,
  details: () => null,
  lineItems: () => null,
  summary: () => null,
  terms: () => null,
  jobDetails: () => null,
  operations: () => null,
  issueDetails: () => null,
  associations: () => null,
  actionTasks: () => null,
  reviewers: () => null,
  // Single-line fields are supported (and mirrored in ZPL). Rich text /
  // key-value lists / spacers / shared sections are not.
  field: ({ block, data }) =>
    block.type === "field" ? (
      <LabelFieldBlock block={block} data={data} />
    ) : null,
  customField: ({ block, data }) =>
    block.type === "customField" ? (
      <CustomFieldBlock
        block={block}
        customFields={(data.item.customFields ?? {}) as Record<string, unknown>}
      />
    ) : null,
  richText: () => null,
  keyValue: () => null,
  spacer: () => null,
  shared: () => null
};
