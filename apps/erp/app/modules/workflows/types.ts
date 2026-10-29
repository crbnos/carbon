// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { WorkflowNode } from "@carbon/ee/workflows";
import type { Edge, Node } from "@xyflow/react";

export type BuilderNode = Node<
  Record<string, unknown>,
  WorkflowNode["type"]
> & {
  name: string;
  expanded?: boolean;
};
export type BuilderEdge = Edge;

/** Why a dropdown could not be filled. Resolved to words in the builder. */
export type OptionsErrorCode =
  | "reconnect"
  | "refreshing"
  | "forbidden"
  | "failed";
