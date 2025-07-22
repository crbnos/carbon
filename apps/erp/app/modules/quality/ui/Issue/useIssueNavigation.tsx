import { useParams } from "@remix-run/react";

import {
  LuClipboardPen,
  LuFileText,
  LuListChecks,
  LuSearch,
} from "react-icons/lu";
import { useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { Issue } from "../../types";

export function useIssueNavigation() {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const routeData = useRouteData<{ nonConformance: Issue }>(path.to.issue(id));
  if (!routeData?.nonConformance?.source)
    throw new Error("Could not find source in routeData");

  const hasInvestigations =
    (routeData.nonConformance.investigationTypes?.length ?? 0) > 0;

  const hasActions =
    (routeData.nonConformance.requiredActions?.length ?? 0) > 0;

  const requiresManagementReview =
    routeData.nonConformance.approvalRequirements?.includes("MRB");

  // const isExternal = routeData.issue.source === "External";

  return [
    {
      name: "Details",
      to: path.to.issueDetails(id),
      icon: LuFileText,
      shortcut: "Command+Shift+d",
    },
    {
      name: "Investigation",
      to: path.to.issueInvestigations(id),
      icon: LuSearch,
      shortcut: "Command+Shift+i",
      isDisabled: !hasInvestigations,
    },
    {
      name: "Actions",
      to: path.to.issueActions(id),
      icon: LuListChecks,
      shortcut: "Command+Shift+a",
      isDisabled: !hasActions,
    },
    // {
    //   name: "Supplier",
    //   to: path.to.issueSupplier(id),
    //   icon: LuContainer,
    //   shortcut: "Command+Shift+s",
    //   isDisabled: !isExternal,
    // },
    {
      name: "Review",
      to: path.to.issueReview(id),
      icon: LuClipboardPen,
      shortcut: "Command+Shift+r",
      isDisabled: !requiresManagementReview,
    },
  ].filter((item) => !item.isDisabled);
}
