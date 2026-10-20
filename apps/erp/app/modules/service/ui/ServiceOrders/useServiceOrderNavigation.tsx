// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import {
  LuCalendarDays,
  LuLayoutDashboard,
  LuListTree,
  LuReceipt
} from "react-icons/lu";
import { useParams } from "react-router";
import type { ProjectSidebarLink } from "~/modules/projects/ui/Project/useProjectNavigation";
import { path } from "~/utils/path";

/**
 * The service order sidebar's page links, as the project sidebar's:
 * Overview (with the order's properties beside it), Work, Visits, Billing.
 */
export function useServiceOrderNavigation(): ProjectSidebarLink[] {
  const { t } = useLingui();
  const { id } = useParams();
  if (!id) throw new Error("id not found");
  const work = path.to.serviceOrderWork(id);

  return [
    {
      name: t`Overview`,
      to: path.to.serviceOrderDetails(id),
      icon: <LuLayoutDashboard />
    },
    {
      name: t`Work`,
      to: work,
      icon: <LuListTree />,
      // An element's own page belongs to the Work page.
      isActive: (pathname) => pathname.startsWith(work)
    },
    {
      name: t`Visits`,
      to: path.to.serviceOrderVisits(id),
      icon: <LuCalendarDays />
    },
    {
      name: t`Billing`,
      to: path.to.serviceOrderBilling(id),
      icon: <LuReceipt />
    }
  ];
}
