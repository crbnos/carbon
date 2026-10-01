// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ItemType } from "~/modules/shared";
import { path } from "~/utils/path";

export function getPathToMakeMethod(
  type: ItemType,
  id: string,
  methodId: string
) {
  switch (type) {
    case "Part":
      return `${path.to.partDetails(id)}?methodId=${methodId}`;
    case "Tool":
      return `${path.to.toolDetails(id)}?methodId=${methodId}`;
    case "Service":
      return `${path.to.serviceDetails(id)}?methodId=${methodId}`;
    default:
      return "#";
  }
}
