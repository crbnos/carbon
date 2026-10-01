// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { DocumentBlockType } from "../../../template";
import { extensionBlocks } from "../extensionRegistry";
import { ConformityDetailsBlock } from "./ConformityDetailsBlock";
import { ConformityStatementBlock } from "./ConformityStatementBlock";
import { DetailsBlock } from "./DetailsBlock";
import { HeaderBlock } from "./HeaderBlock";
import { LineItemsBlock } from "./LineItemsBlock";
import { NotesBlock } from "./NotesBlock";
import { PartiesBlock } from "./PartiesBlock";
import type { BlockRenderer } from "./types";

/**
 * Block-type → renderer for the Certificate of Conformance (AS9163). Reuses the
 * shared header/parties/details/lineItems/notes block TYPES, rendered with the
 * certificate's own numbered-field components.
 */
export const certificateOfConformanceBlockRegistry: Partial<
  Record<DocumentBlockType, BlockRenderer>
> = {
  ...extensionBlocks,
  header: ({ data }) => <HeaderBlock data={data} />,
  parties: ({ data }) => <PartiesBlock data={data} />,
  details: ({ data }) => <DetailsBlock data={data} />,
  lineItems: ({ block, data }) =>
    block.type === "lineItems" ? (
      <LineItemsBlock block={block} data={data} />
    ) : null,
  conformityDetails: ({ data }) => <ConformityDetailsBlock data={data} />,
  conformityStatement: ({ data }) => <ConformityStatementBlock data={data} />,
  notes: ({ data }) => <NotesBlock data={data} />
};
