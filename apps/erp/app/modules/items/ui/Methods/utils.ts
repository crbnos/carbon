import type { MethodItemType } from "~/modules/shared";
import { path } from "~/utils/path";

export function getPathToMakeMethod(
  type: MethodItemType,
  id: string,
  methodId: string
) {
  switch (type) {
    case "Part":
      return path.to.partMakeMethod(id, methodId);
    case "Tool":
      return path.to.toolMakeMethod(id, methodId);
    default:
      return "#";
  }
}
