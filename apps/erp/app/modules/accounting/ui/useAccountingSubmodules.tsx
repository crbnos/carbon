// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import {
  LuArrowLeftRight,
  LuAxis3D,
  LuBetweenHorizontalStart,
  LuBookOpen,
  LuBoxes,
  LuBuilding2,
  LuCalendar1,
  LuCalendarCheck,
  LuCalendarClock,
  LuClock,
  LuCoins,
  LuEuro,
  LuFileSpreadsheet,
  LuHandCoins,
  LuKeyRound,
  LuLayers,
  LuPercent,
  LuScale,
  LuSheet,
  LuTruck
} from "react-icons/lu";
import { usePermissions, useRouteData } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
import { useGovernmentContracting } from "~/modules/projects/ui/useGovernmentContracting";
import type { AuthenticatedRouteGroup } from "~/types";
import { visibleGroups } from "~/utils/nav";
import { path } from "~/utils/path";

const multiCompanyRoutes = new Set<string>([path.to.intercompany]);

/** Routes that only make sense with an active accounting integration
 * (xero/quickbooks/rillet) — hidden otherwise. */
const integrationRoutes = new Set<string>([path.to.accountingSyncTieOut]);

/** Government contracting routes — hidden from a company that does none.
 * With it on and the plan gated, they show and the pages show the upgrade
 * overlay. */
const governmentContractingRoutes = new Set<string>([
  path.to.indirectRates,
  path.to.indirectPools
]);

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
            icon: <LuFileSpreadsheet />
          },
          {
            name: t`Sync Tie-Out`,
            to: path.to.accountingSyncTieOut,
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
            icon: <LuBookOpen />,
            table: "journal"
          },
          {
            name: t`Intercompany`,
            to: path.to.intercompany,
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
            icon: <LuCalendarCheck />,
            table: "accountingPeriod"
          },
          {
            name: t`Depreciation`,
            to: path.to.depreciationRuns,
            icon: <LuClock />
          },
          {
            name: t`Indirect Rates`,
            to: path.to.indirectRates,
            icon: <LuPercent />
          },
          {
            name: t`Leases`,
            to: path.to.leaseRuns,
            icon: <LuKeyRound />
          },
          {
            name: t`Revenue Recognition`,
            to: path.to.revenueRecognitionRuns,
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
            icon: <LuBuilding2 />,
            table: "fixedAsset"
          },
          {
            name: t`Fleet`,
            to: path.to.fleet,
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
            icon: <LuLayers />
          },
          {
            name: t`Chart of Accounts`,
            to: path.to.chartOfAccounts,
            icon: <LuSheet />
          },
          {
            name: t`Cost Centers`,
            to: path.to.costCenters,
            icon: <LuCoins />
          },
          {
            name: t`Default Accounts`,
            to: path.to.accountingDefaults,
            icon: <LuBetweenHorizontalStart />
          },
          {
            name: t`Dimensions`,
            to: path.to.dimensions,
            icon: <LuAxis3D />
          },
          {
            name: t`Exchange Rates`,
            to: path.to.exchangeRates,
            icon: <LuEuro />
          },
          {
            name: t`Fiscal Year`,
            to: path.to.fiscalYears,
            icon: <LuCalendar1 />
          },
          {
            name: t`Indirect Pools`,
            to: path.to.indirectPools,
            icon: <LuBoxes />
          },
          {
            name: t`Payment Terms`,
            to: path.to.paymentTerms,
            icon: <LuHandCoins />
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
  const isGovernmentContracting = useGovernmentContracting();

  const isEnabled = (route: { to: string }) =>
    (hasMultipleCompanies || !multiCompanyRoutes.has(route.to)) &&
    (hasAccountingIntegration || !integrationRoutes.has(route.to)) &&
    (isGovernmentContracting || !governmentContractingRoutes.has(route.to));

  return {
    groups: visibleGroups(accountingRoutes, permissions, isEnabled).map(
      (group) => ({
        ...group,
        routes: group.routes.map(addSavedViewsToRoutes)
      })
    )
  };
}
