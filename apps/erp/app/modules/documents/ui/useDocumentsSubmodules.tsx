import {
  LuClock,
  LuFolder,
  LuFolderHeart,
  LuPin,
  LuTrash,
} from "react-icons/lu";
import type { Route } from "~/types";
import { path } from "~/utils/path";

const documentsRoutes: Route[] = [
  {
    name: "All Documents",
    to: path.to.documents,
    icon: <LuFolder />,
  },
  {
    name: "My Documents",
    to: path.to.documents,
    q: "my",
    icon: <LuFolderHeart />,
  },
  {
    name: "Recent",
    to: path.to.documents,
    q: "recent",
    icon: <LuClock />,
  },
  {
    name: "Pinned",
    to: path.to.documents,
    q: "starred",
    icon: <LuPin />,
  },
  {
    name: "Trash",
    to: path.to.documents,
    q: "trash",
    icon: <LuTrash />,
  },
];

export default function useDocumentsSubmodules() {
  return { links: documentsRoutes };
}
