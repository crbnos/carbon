// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { useParams } from "react-router";
import { DetailSidebar } from "~/components/Layout";
import { useOptimisticLocation, usePermissions, useRouteData } from "~/hooks";
import type { ProjectTreeElement } from "~/modules/projects/ui/Project/ProjectElementTree";
import { ProjectElementTree } from "~/modules/projects/ui/Project/ProjectElementTree";
import { path } from "~/utils/path";
import type { ServiceOrder } from "../../types";
import { useServiceOrderNavigation } from "./useServiceOrderNavigation";

/**
 * The service order workspace's left panel, as the project sidebar: the page
 * links, then the work's element tree while the Work page is open.
 */
export function ServiceOrderSidebar() {
  const { t } = useLingui();
  const { id } = useParams();
  if (!id) throw new Error("id not found");
  const location = useOptimisticLocation();
  const links = useServiceOrderNavigation();
  const data = useRouteData<{
    serviceOrder: ServiceOrder;
    treeElements: ProjectTreeElement[];
  }>(path.to.serviceOrder(id));

  const permissions = usePermissions();

  const isWorkPage = location.pathname.startsWith(path.to.serviceOrderWork(id));
  // The work routes refuse a Closed project: a Closed or Cancelled order.
  const canMoveElements =
    permissions.can("update", "service") &&
    !!data &&
    !["Closed", "Cancelled"].includes(data.serviceOrder.status ?? "");

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <nav aria-label={t`Service order pages`} className="shrink-0">
        <DetailSidebar links={links} />
      </nav>
      {isWorkPage && data && (
        <ProjectElementTree
          projectId={data.serviceOrder.projectId}
          elements={data.treeElements}
          canMove={canMoveElements}
          className="flex-1 border-t border-border pt-2"
        />
      )}
    </div>
  );
}
