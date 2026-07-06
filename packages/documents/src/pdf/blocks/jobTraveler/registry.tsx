import type { DocumentBlockType } from "../../../template";
import { CustomFieldBlock } from "../CustomFieldBlock";
import { extensionBlocks } from "../extensionRegistry";
import { HeaderBlock } from "./HeaderBlock";
import { JobDetailsBlock } from "./JobDetailsBlock";
import { NotesBlock } from "./NotesBlock";
import { OperationsBlock } from "./OperationsBlock";
import type { BlockRenderer } from "./types";

/** Block-type → renderer for the Job Traveler. Extension blocks are shared. */
export const jobTravelerBlockRegistry: Partial<
  Record<DocumentBlockType, BlockRenderer>
> = {
  ...extensionBlocks,
  header: ({ data }) => <HeaderBlock data={data} />,
  jobDetails: ({ data }) => <JobDetailsBlock data={data} />,
  operations: ({ block, data }) =>
    block.type === "operations" ? (
      <OperationsBlock block={block} data={data} />
    ) : null,
  notes: ({ data }) => <NotesBlock data={data} />,
  customField: ({ block, data }) =>
    block.type === "customField" ? (
      <CustomFieldBlock
        block={block}
        customFields={(data.job?.customFields ?? {}) as Record<string, unknown>}
      />
    ) : null
};
