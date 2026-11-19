// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
  issueDetails: ({ block, data }) => (
    <IssueDetailsBlock block={block} data={data} />
  ),
  associations: ({ block, data }) => (
    <AssociationsBlock block={block} data={data} />
  ),
  notes: ({ block, data }) => <NotesBlock block={block} data={data} />,
  actionTasks: ({ block, data }) => (
    <ActionTasksBlock block={block} data={data} />
  ),
  reviewers: ({ block, data }) => <ReviewersBlock block={block} data={data} />,
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
