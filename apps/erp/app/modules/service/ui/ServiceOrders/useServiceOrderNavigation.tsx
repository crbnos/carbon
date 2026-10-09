// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { LuFileText } from "react-icons/lu";
import { useParams } from "react-router";
import { path } from "~/utils/path";

/** The route tabs of a service order. */
export function useServiceOrderNavigation() {
  const { t } = useLingui();
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  return [
    {
      name: t`Details`,
      to: path.to.serviceOrderDetails(id),
      icon: LuFileText
    }
  ];
}
