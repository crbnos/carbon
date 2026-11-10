// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useFeatureFlags } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import {
  LuBlocks,
  LuBox,
  LuCalendarClock,
  LuCircleCheck,
  LuClipboardCheck,
  LuCreditCard,
  LuCrown,
  LuDatabase,
  LuFactory,
  LuFileText,
  LuFlaskConical,
  LuFolderCheck,
  LuFolderKanban,
  LuHeadphones,
  LuHeartHandshake,
  LuHistory,
  LuImage,
  LuKey,
  LuLandmark,
  LuLayoutDashboard,
  LuNetwork,
  LuPrinter,
  LuScanBarcode,
  LuSheet,
  LuShieldCheck,
  LuShoppingCart,
  LuTimer,
  LuUsers,
  LuWebhook,
  LuWorkflow
} from "react-icons/lu";
import { usePermissions } from "~/hooks";
import { useFlags } from "~/hooks/useFlags";
import { usePlanGate } from "~/hooks/usePlanGate";
import type { AuthenticatedRouteGroup } from "~/types";
import { visibleGroups } from "~/utils/nav";
import { path } from "~/utils/path";

export default function useSettingsSubmodules() {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { isCloud, isControlledEnvironment, isInternal, isLocalDev } =
    useFlags();
  const { feature } = useFeatureFlags();
  const canManageCompanies = isInternal || feature("multi-company-management");
  // Enterprise: backups are a Business plan feature, but internal staff and
  // local dev keep access (mirrors the server `canManageBackups`).
  const { isGated: backupsGated } = usePlanGate({ feature: "BACKUPS" });

  const settingsRoutes: AuthenticatedRouteGroup<{
    requiresOwnership?: boolean;
    requiresCloudEnvironment?: boolean;
    requiresControlledEnvironment?: boolean;
  }>[] = useMemo(
    () => [
      {
        name: t`Company`,
        routes: [
          {
            name: t`Billing`,
            to: path.to.billing,
            icon: <LuCreditCard />,
            requiresOwnership: true,
            requiresCloudEnvironment: true
          },
          {
            name: t`Company`,
            to: path.to.company,
            icon: <LuFactory />
          },
          {
            name: t`Companies`,
            to: path.to.companies,
            icon: <LuNetwork />
          },
          {
            name: t`Document Templates`,
            to: path.to.documentTemplates,
            icon: <LuFileText />
          },
          {
            name: t`Logos`,
            to: path.to.logos,
            icon: <LuImage />
          },
          {
            name: t`Printing`,
            to: path.to.printingSettings,
            icon: <LuPrinter />
          }
        ]
      },
      {
        name: t`Modules`,
        routes: [
          {
            name: t`Accounting`,
            to: path.to.accountingSettings,
            icon: <LuLandmark />
          },
          {
            name: t`Inventory`,
            to: path.to.inventorySettings,
            icon: <LuBox />
          },
          {
            name: t`Invoicing`,
            to: path.to.invoicingSettings,
            icon: <LuCreditCard />
          },
          {
            name: t`Items`,
            to: path.to.itemsSettings,
            icon: <LuBlocks />
          },
          {
            name: t`People`,
            to: path.to.peopleSettings,
            icon: <LuUsers />
          },
          {
            name: t`Planning`,
            to: path.to.planningSettings,
            icon: <LuCalendarClock />
          },
          {
            name: t`Purchasing`,
            to: path.to.purchasingSettings,
            icon: <LuShoppingCart />
          },
          {
            name: t`Production`,
            to: path.to.productionSettings,
            icon: <LuFactory />
          },
          {
            name: t`Projects`,
            to: path.to.projectsSettings,
            icon: <LuFolderKanban />
          },
          {
            name: t`Time`,
            to: path.to.timeSettings,
            icon: <LuTimer />
          },
          {
            name: t`Service`,
            to: path.to.serviceSettings,
            icon: <LuHeadphones />
          },
          {
            name: t`Quality`,
            to: path.to.qualitySettings,
            icon: <LuFolderCheck />
          },
          {
            name: t`Sales`,
            to: path.to.salesSettings,
            icon: <LuCrown />
          },
          {
            name: t`Resources`,
            to: path.to.resourcesSettings,
            icon: <LuHeartHandshake />
          }
        ]
      },
      {
        name: t`System`,
        routes: [
          {
            name: t`API Keys`,
            to: path.to.apiKeys,
            icon: <LuKey />
          },
          {
            name: t`Approval Rules`,
            to: path.to.approvalRules,
            icon: <LuCircleCheck />
          },
          {
            name: t`Audit Logs`,
            to: path.to.auditLog,
            icon: <LuHistory />
          },
          {
            name: t`Backups`,
            to: path.to.backups,
            icon: <LuDatabase />
          },
          {
            name: t`Custom Fields`,
            to: path.to.customFields,
            icon: <LuLayoutDashboard />
          },
          {
            name: t`Demo Data`,
            to: path.to.demoData,
            icon: <LuFlaskConical />
          },
          {
            name: t`Integrations`,
            to: path.to.integrations,
            icon: <LuWorkflow />
          },
          {
            name: t`ITAR Certifications`,
            to: path.to.itarCertifications,
            icon: <LuClipboardCheck />,
            requiresControlledEnvironment: true
          },
          {
            name: t`Security`,
            to: path.to.security,
            icon: <LuShieldCheck />
          },
          {
            name: t`Sequences`,
            to: path.to.sequences,
            icon: <LuSheet />
          },
          {
            name: t`Serial Numbers`,
            to: path.to.serialNumberSequences,
            icon: <LuScanBarcode />
          },
          {
            name: t`Webhooks`,
            to: path.to.webhooks,
            icon: <LuWebhook />
          }
        ]
      }
    ],
    [t]
  );

  const isEnabled = (
    route: (typeof settingsRoutes)[number]["routes"][number]
  ) => {
    if (route.requiresOwnership && !permissions.isOwner()) return false;
    if (route.requiresCloudEnvironment && !isCloud) return false;
    if (route.requiresControlledEnvironment && !isControlledEnvironment)
      return false;
    if (route.to === path.to.companies && !canManageCompanies) return false;
    // Backups: visible to Business/Enterprise, internal staff, or local dev.
    if (
      route.to === path.to.backups &&
      backupsGated &&
      !isInternal &&
      !isLocalDev
    )
      return false;
    return true;
  };

  return { groups: visibleGroups(settingsRoutes, permissions, isEnabled) };
}
