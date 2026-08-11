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
  LuClock,
  LuCoins,
  LuEuro,
  LuFileSpreadsheet,
  LuHandCoins,
  LuLayers,
  LuSheet
} from "react-icons/lu";
import { usePermissions, useRouteData } from "~/hooks";
import type { AuthenticatedRouteGroup, Role } from "~/types";
import { path } from "~/utils/path";

const multiCompanyRoutes = new Set<string>([path.to.intercompany]);

export default function useAccountingSubmodules() {
  const { t } = useLingui();
  const accountingRoutes: AuthenticatedRouteGroup[] = useMemo(
    () => [
      {
        name: t`Reports`,
        routes: [
          {
            name: t`Reporting`,
            to: path.to.reports,
            role: "employee",
            icon: <LuFileSpreadsheet />
          }
        ]
      },
      {
        name: t`General Ledger`,
        routes: [
          {
            name: t`Intercompany`,
            to: path.to.intercompany,
            role: "employee",
            icon: <LuArrowLeftRight />
          },
          {
            name: t`Journal Entries`,
            to: path.to.accountingJournals,
            role: "employee",
            icon: <LuBookOpen />
          },
          {
            name: t`Accounting Periods`,
            to: path.to.accountingPeriods,
            role: "employee",
            icon: <LuCalendarCheck />
          }
        ]
      },

      {
        name: t`Fixed Assets`,
        routes: [
          {
            name: t`Assets`,
            to: path.to.fixedAssets,
            role: "employee",
            icon: <LuBuilding2 />
          },
          {
            name: t`Depreciation`,
            to: path.to.depreciationRuns,
            role: "employee",
            icon: <LuClock />
          }
        ]
      },
      {
        name: t`Configure`,
        routes: [
          {
            name: t`Asset Classes`,
            to: path.to.assetClasses,
            role: "employee",
            icon: <LuLayers />
          },
          {
            name: t`Chart of Accounts`,
            to: path.to.chartOfAccounts,
            role: "employee",
            icon: <LuSheet />
          },
          {
            name: t`Cost Centers`,
            to: path.to.costCenters,
            role: "employee",
            icon: <LuCoins />
          },
          {
            name: t`Default Accounts`,
            to: path.to.accountingDefaults,
            icon: <LuBetweenHorizontalStart />,
            role: "employee"
          },
          {
            name: t`Dimensions`,
            to: path.to.dimensions,
            role: "employee",
            icon: <LuAxis3D />
          },
          {
            name: t`Exchange Rates`,
            to: path.to.exchangeRates,
            role: "employee",
            icon: <LuEuro />
          },
          {
            name: t`Fiscal Year`,
            to: path.to.fiscalYears,
            role: "employee",
            icon: <LuCalendar1 />
          },
          {
            name: t`Payment Terms`,
            to: path.to.paymentTerms,
            role: "employee",
            icon: <LuHandCoins />
          }
        ]
      }
    ],
    [t]
  );

  const permissions = usePermissions();
  const routeData = useRouteData<{ hasMultipleCompanies: boolean }>(
    path.to.accounting
  );
  const hasMultipleCompanies = routeData?.hasMultipleCompanies ?? false;

  const isRouteVisible = (route: { to: string; role?: string }) => {
    if (route.role && !permissions.is(route.role as Role)) return false;
    if (!hasMultipleCompanies && multiCompanyRoutes.has(route.to)) return false;
    return true;
  };

  return {
    groups: accountingRoutes
      .filter((group) => group.routes.some(isRouteVisible))
      .map((group) => ({
        ...group,
        routes: group.routes.filter(isRouteVisible)
      }))
  };
}
