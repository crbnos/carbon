// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import {
  LuClock,
  LuFolder,
  LuFolderHeart,
  LuPin,
  LuTrash
} from "react-icons/lu";
import { usePermissions } from "~/hooks";
import type { Route } from "~/types";
import { path } from "~/utils/path";

export default function useDocumentsSubmodules() {
  const { t } = useLingui();
  const permissions = usePermissions();

  const documentsRoutes: Route[] = [
    {
      name: t`All Documents`,
      to: path.to.documents,
      page: "documents",
      icon: <LuFolder />
    },
    {
      name: t`My Documents`,
      to: path.to.documents,
      page: "documents",
      q: "my",
      icon: <LuFolderHeart />
    },
    {
      name: t`Recent`,
      to: path.to.documents,
      page: "documents",
      q: "recent",
      icon: <LuClock />
    },
    {
      name: t`Pinned`,
      to: path.to.documents,
      page: "documents",
      q: "starred",
      icon: <LuPin />
    },
    {
      name: t`Trash`,
      to: path.to.documents,
      page: "documents",
      q: "trash",
      icon: <LuTrash />
    }
  ];

  return {
    links: documentsRoutes.filter(
      (route) => !route.page || permissions.has({ [route.page]: "View" })
    )
  };
}
