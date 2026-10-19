// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { PageId } from "@carbon/database/access";
import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import {
  LuArrowLeftRight,
  LuAxis3D,
  LuBetweenHorizontalStart,
  LuBookOpen,
  LuBuilding2,
  LuCalendar1,
  LuCalendarCheck,
  LuCalendarClock,
  LuClock,
  LuCoins,
  LuEuro,
  LuFileSpreadsheet,
  LuFolderKanban,
  LuHandCoins,
  LuKeyRound,
  LuLayers,
  LuScale,
  LuSheet,
  LuTruck
} from "react-icons/lu";
import { usePermissions, useRouteData } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { AuthenticatedRouteGroup, Role } from "~/types";
import { path } from "~/utils/path";

const multiCompanyRoutes = new Set<string>([path.to.intercompany]);

/** Routes that only make sense with an active accounting integration
 * (xero/quickbooks/rillet) — hidden otherwise. */
const integrationRoutes = new Set<string>([path.to.accountingSyncTieOut]);

export default function useAccountingSubmodules() {
  const { t } = useLingui();
  const { addSavedViewsToRoutes } = useSavedViews();
  const accountingRoutes: AuthenticatedRouteGroup[] = useMemo(
    () => [
      {
        name: t`Reports`,
        routes: [
          {
            name: t`Reporting`,
            to: path.to.reports,
            page: "accounting.reporting",
            role: "employee",
            icon: <LuFileSpreadsheet />
          },
          {
            name: t`Sync Tie-Out`,
            to: path.to.accountingSyncTieOut,
            page: "accounting.syncTieOut",
            role: "employee",
            icon: <LuScale />
          }
        ]
      },
      {
        name: t`General Ledger`,
        routes: [
          {
            name: t`Journal Entries`,
            to: path.to.accountingJournals,
            page: "accounting.journalEntries",
            role: "employee",
            icon: <LuBookOpen />,
            table: "journal"
          },
          {
            name: t`Intercompany`,
            to: path.to.intercompany,
            page: "accounting.intercompany",
            role: "employee",
            icon: <LuArrowLeftRight />
          }
        ]
      },
      {
        name: t`Closing`,
        routes: [
          {
            name: t`Accounting Periods`,
            to: path.to.accountingPeriods,
            page: "accounting.accountingPeriods",
            role: "employee",
            icon: <LuCalendarCheck />,
            table: "accountingPeriod"
          },
          {
            name: t`Depreciation`,
            to: path.to.depreciationRuns,
            page: "accounting.depreciation",
            role: "employee",
            icon: <LuClock />
          },
          {
            name: t`Leases`,
            to: path.to.leaseRuns,
            page: "accounting.leases",
            role: "employee",
            icon: <LuKeyRound />
          },
          {
            name: t`Revenue Recognition`,
            to: path.to.revenueRecognitionRuns,
            page: "accounting.revenueRecognition",
            role: "employee",
            icon: <LuCalendarClock />
          }
        ]
      },
      {
        name: t`Fixed Assets`,
        routes: [
          {
            name: t`Assets`,
            to: path.to.fixedAssets,
            page: "accounting.assets",
            role: "employee",
            icon: <LuBuilding2 />,
            table: "fixedAsset"
          },
          {
            name: t`Fleet`,
            to: path.to.fleet,
            page: "accounting.fleet",
            role: "employee",
            icon: <LuTruck />,
            table: "fleetAssets"
          }
        ]
      },
      {
        name: t`Configure`,
        routes: [
          {
            name: t`Asset Classes`,
            to: path.to.assetClasses,
            page: "accounting.assetClasses",
            role: "employee",
            icon: <LuLayers />
          },
          {
            name: t`Chart of Accounts`,
            to: path.to.chartOfAccounts,
            page: "accounting.chartOfAccounts",
            role: "employee",
            icon: <LuSheet />
          },
          {
            name: t`Cost Centers`,
            to: path.to.costCenters,
            page: "accounting.costCenters",
            role: "employee",
            icon: <LuCoins />
          },
          {
            name: t`Default Accounts`,
            to: path.to.accountingDefaults,
            page: "accounting.defaultAccounts",
            icon: <LuBetweenHorizontalStart />,
            role: "employee"
          },
          {
            name: t`Dimensions`,
            to: path.to.dimensions,
            page: "accounting.dimensions",
            role: "employee",
            icon: <LuAxis3D />
          },
          {
            name: t`Exchange Rates`,
            to: path.to.exchangeRates,
            page: "accounting.exchangeRates",
            role: "employee",
            icon: <LuEuro />
          },
          {
            name: t`Fiscal Year`,
            to: path.to.fiscalYears,
            page: "accounting.fiscalYear",
            role: "employee",
            icon: <LuCalendar1 />
          },
          {
            name: t`Payment Terms`,
            to: path.to.paymentTerms,
            page: "accounting.paymentTerms",
            role: "employee",
            icon: <LuHandCoins />
          },
          {
            name: t`Projects`,
            to: path.to.projects,
            page: "accounting.projects",
            role: "employee",
            icon: <LuFolderKanban />
          }
        ]
      }
    ],
    [t]
  );

  const permissions = usePermissions();
  const routeData = useRouteData<{
    hasMultipleCompanies: boolean;
    accountingIntegrations: string[];
  }>(path.to.accounting);
  const hasMultipleCompanies = routeData?.hasMultipleCompanies ?? false;
  const hasAccountingIntegration =
    (routeData?.accountingIntegrations?.length ?? 0) > 0;

  const isRouteVisible = (route: {
    to: string;
    role?: string;
    page?: PageId;
  }) => {
    if (route.role && !permissions.is(route.role as Role)) return false;
    if (route.page && !permissions.has({ [route.page]: "View" })) return false;
    if (!hasMultipleCompanies && multiCompanyRoutes.has(route.to)) return false;
    if (!hasAccountingIntegration && integrationRoutes.has(route.to))
      return false;
    return true;
  };

  return {
    groups: accountingRoutes
      .filter((group) => group.routes.some(isRouteVisible))
      .map((group) => ({
        ...group,
        routes: group.routes.filter(isRouteVisible).map(addSavedViewsToRoutes)
      }))
  };
}
