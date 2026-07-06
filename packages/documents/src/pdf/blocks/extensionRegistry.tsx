import type {
  DocumentBlock,
  DocumentBlockType,
  ResolvedSection
} from "../../template";
import { Watermark } from "../components";
import { FieldBlock } from "./FieldBlock";
import { KeyValueBlock } from "./KeyValueBlock";
import { RichTextBlock } from "./RichTextBlock";
import { SharedBlock } from "./SharedBlock";
import { SpacerBlock } from "./SpacerBlock";

/**
 * The minimal data every extension renderer needs. Each document's richer data
 * bag (QuoteData, JobTravelerData, …) is a superset, so these renderers slot
 * into any document registry.
 */
interface ExtensionData {
  vars: Record<string, string>;
  sections: Record<string, ResolvedSection>;
  company?: { logoWatermark?: string | null };
}

type ExtensionRenderer = (args: {
  block: DocumentBlock;
  data: ExtensionData;
}) => JSX.Element | null;

/**
 * The doc-agnostic extension blocks, defined once. Every non-label document
 * registry spreads this in instead of copy-pasting the same five entries — so
 * adding an extension block is a one-line change here, not an edit across every
 * registry. (Tracking labels are text-only and intentionally opt out.)
 */
export const extensionBlocks: Partial<
  Record<DocumentBlockType, ExtensionRenderer>
> = {
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
  field: ({ block, data }) =>
    block.type === "field" ? (
      <FieldBlock block={block} vars={data.vars} />
    ) : null,
  watermark: ({ block, data }) =>
    block.type === "watermark" ? (
      <Watermark
        src={data.company?.logoWatermark}
        show
        opacity={block.opacity}
        placement={block.placement}
        size={block.size}
      />
    ) : null
};
