import type { MethodItemType } from "~/modules/shared";
import { path } from "~/utils/path";

export function getPathToMakeMethod(
  type: MethodItemType,
  id: string,
  methodId: string
) {
  switch (type) {
    case "Part":
      return `${path.to.partDetails(id)}?methodId=${methodId}`;
    case "Tool":
      return `${path.to.toolDetails(id)}?methodId=${methodId}`;
    default:
      return "#";
  }
}
