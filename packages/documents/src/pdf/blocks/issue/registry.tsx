import type { DocumentBlockType } from "../../../template";
import { CustomFieldBlock } from "../CustomFieldBlock";
import { extensionBlocks } from "../extensionRegistry";
import { ActionTasksBlock } from "./ActionTasksBlock";
import { AssociationsBlock } from "./AssociationsBlock";
import { HeaderBlock } from "./HeaderBlock";
import { IssueDetailsBlock } from "./IssueDetailsBlock";
import { NotesBlock } from "./NotesBlock";
import { ReviewersBlock } from "./ReviewersBlock";
import type { BlockRenderer } from "./types";

/** Block-type → renderer for the Issue report. Extension blocks are shared. */
export const issueBlockRegistry: Partial<
  Record<DocumentBlockType, BlockRenderer>
> = {
  ...extensionBlocks,
  header: ({ data }) => <HeaderBlock data={data} />,
  issueDetails: ({ data }) => <IssueDetailsBlock data={data} />,
  associations: ({ data }) => <AssociationsBlock data={data} />,
  notes: ({ data }) => <NotesBlock data={data} />,
  actionTasks: ({ data }) => <ActionTasksBlock data={data} />,
  reviewers: ({ data }) => <ReviewersBlock data={data} />,
  customField: ({ block, data }) =>
    block.type === "customField" ? (
      <CustomFieldBlock
        block={block}
        customFields={
          (data.nonConformance?.customFields ?? {}) as Record<string, unknown>
        }
      />
    ) : null
};
