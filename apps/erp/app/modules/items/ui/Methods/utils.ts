import { path } from "~/utils/path";

export function getPathToMakeMethod(type: string, id: string) {
  switch (type) {
    case "Part":
      return path.to.partMakeMethod(id);
    case "Tool":
      return path.to.toolMakeMethod(id);
    default:
      return "#";
  }
}
