import {
  EMPTY_EXCLUSIONS,
  type HubExclusions,
  isPageVisible,
  PAGE_GROUP_LABEL,
  PAGE_GROUP_ORDER,
  REGISTRY,
  type Tier
} from "@carbon/onboarding";
import { useRouteData } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import {
  LuClipboardCheck,
  LuClipboardList,
  LuDatabase,
  LuFileText,
  LuFlagTriangleRight,
  LuGraduationCap,
  LuHandshake,
  LuLayoutDashboard,
  LuListChecks,
  LuRocket,
  LuSettings,
  LuSwords,
  LuUsers
} from "react-icons/lu";
import { useCustomerPreview } from "~/hooks/useCustomerPreview";
import { useFlags } from "~/hooks/useFlags";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

const ICON: Record<string, ReactNode> = {
  start: <LuRocket />,
  team: <LuUsers />,
  "how-we-work": <LuHandshake />,
  scope: <LuFileText />,
  roles: <LuUsers />,
  value: <LuLayoutDashboard />,
  plan: <LuListChecks />,
  board: <LuClipboardList />,
  setup: <LuClipboardCheck />,
  data: <LuDatabase />,
  requirements: <LuFileText />,
  "go-live": <LuFlagTriangleRight />,
  training: <LuGraduationCap />,
  controls: <LuSettings />,
  positioning: <LuSwords />
};

// Grouped secondary sidebar for /x/get-started, built from the package's page
// registry. Carbon-only pages are filtered out for non-internal users.
export function useImplementationSubmodules() {
  const { i18n } = useLingui();
  const { isInternal } = useFlags();
  const previewingAsCustomer = useCustomerPreview();
  // When an internal user previews as the customer, hide carbon-only pages.
  const effectiveInternal = isInternal && !previewingAsCustomer;
  const data = useRouteData<{
    hub?: { exclusions?: HubExclusions; tier?: Tier };
  }>(path.to.getStarted);
  const exclusions = data?.hub?.exclusions ?? EMPTY_EXCLUSIONS;
  const tier = data?.hub?.tier;

  const groups: AuthenticatedRouteGroup[] = PAGE_GROUP_ORDER.map((group) => ({
    name: i18n._(PAGE_GROUP_LABEL[group]),
    routes: REGISTRY.filter((p) => p.group === group)
      .filter((p) => isPageVisible(p, exclusions, effectiveInternal, tier))
      .sort((a, b) => a.order - b.order)
      .map((p) => ({
        name: i18n._(p.navLabel),
        to:
          p.slug === "start"
            ? path.to.getStarted
            : path.to.getStartedPage(p.slug),
        icon: ICON[p.slug]
      }))
  })).filter((group) => group.routes.length > 0);

  return { groups };
}
