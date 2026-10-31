// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import {
  EMPTY_EXCLUSIONS,
  type HubContacts,
  type HubExclusions,
  hubAccess,
  type ImplementationRowData,
  UNENROLLED_HUB
} from "@carbon/implementation-hub";
import {
  getImplementationAssignments,
  getImplementationCheckStates,
  getImplementationFieldValues,
  getImplementationHub,
  getImplementationRows
} from "@carbon/implementation-hub/server";
import {
  type HubData,
  type HubFlags,
  type HubMutation,
  HubProvider,
  toFormFields
} from "@carbon/implementation-hub/ui";
import { useRealtimeTable } from "@carbon/query";
import { RecordOutlet } from "@carbon/react";
import { isInternalEmail, redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useCallback, useMemo } from "react";
import { LuListChecks, LuSettings, LuUser } from "react-icons/lu";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { GroupedContentSidebar } from "~/components/Layout";
import { useUser } from "~/hooks";
import { useFlags } from "~/hooks/useFlags";
import {
  isImplementationPreview,
  useImplementationPreview
} from "~/hooks/useImplementationPreview";
import { useImplementationRealtime } from "~/hooks/useImplementationRealtime";
import { usesPersonalPages } from "~/modules/shared/shared.models";
import {
  getImplementationCounts,
  getImplementationSignals,
  personalPagesEnabled
} from "~/modules/shared/shared.service";
import { usePeople } from "~/stores";
import type { RouteGroup } from "~/types";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { trainingConfig } from "~/utils/training";

export { RouteErrorBoundary as ErrorBoundary } from "@carbon/react/ErrorBoundary";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Implementation" }];
};

// Deep links from the hub's cards: each setup item's stable key → the ERP
// screen where you configure that thing. Keys without a screen are simply
// omitted (the card has no Open link). Operational tasks and nested product
// steps resolve through the same map.
const SETUP_SCREEN_PATHS: Record<string, string> = {
  company: path.to.company,
  "document-templates": path.to.documentTemplates,
  logos: path.to.logos,
  printing: path.to.printingSettings,
  sequences: path.to.sequences,
  "custom-fields": path.to.customFields,
  integrations: path.to.integrations,
  "approval-rules": path.to.approvalRules,
  locations: path.to.locations,
  "work-centers": path.to.workCenters,
  processes: path.to.processes,
  training: path.to.abilities,
  "failure-modes": path.to.failureModes,
  employees: path.to.employeeAccounts,
  departments: path.to.departments,
  shifts: path.to.shifts,
  holidays: path.to.holidays,
  attributes: path.to.attributes,
  "employee-types": path.to.employeeTypes,
  groups: path.to.groups,
  units: path.to.uoms,
  parts: path.to.parts,
  materials: path.to.materials,
  tools: path.to.tools,
  consumables: path.to.consumables,
  "material-dimensions": path.to.materialDimensions,
  "material-types": path.to.materialTypes,
  "material-substances": path.to.materialSubstances,
  "material-shapes": path.to.materialForms,
  "material-grades": path.to.materialGrades,
  "material-finishes": path.to.materialFinishes,
  customers: path.to.customers,
  "customer-types": path.to.customerTypes,
  "customer-statuses": path.to.customerStatuses,
  "price-lists": path.to.salesPriceList,
  "pricing-rules": path.to.salesPricingRules,
  "no-quote-reasons": path.to.noQuoteReasons,
  suppliers: path.to.suppliers,
  "supplier-types": path.to.supplierTypes,
  "item-groups": path.to.itemPostingGroups,
  "accounting-dimensions": path.to.dimensions,
  "storage-units": path.to.storageUnits,
  "storage-types": path.to.storageTypes,
  "storage-rules": path.to.storageRules,
  "shipping-methods": path.to.shippingMethods,
  "chart-of-accounts": path.to.chartOfAccountsImport,
  "default-accounts": path.to.accountingDefaults,
  "cost-centers": path.to.costCenters,
  "payment-terms": path.to.paymentTerms,
  "exchange-rates": path.to.exchangeRates,
  "fiscal-year": path.to.fiscalYears,
  "accounting-periods": path.to.accountingPeriods,
  "asset-classes": path.to.assetClasses,
  "fixed-assets": path.to.fixedAssets,
  "scrap-reasons": path.to.scrapReasons,
  "maintenance-schedules": path.to.maintenanceSchedules,
  // The Plan's operational tasks (by task key): their evidence links to the
  // list of the documents it counts.
  "first-quote": path.to.quotes,
  "first-purchase-order": path.to.purchaseOrders,
  "first-receipt": path.to.receipts,
  "first-sales-order": path.to.salesOrders,
  "first-job": path.to.jobs,
  "first-job-completed": path.to.jobs,
  // The priority set questionnaire card on a person's page.
  "get-started:priority-set": path.to.implementationPrioritySet,
  // Nested product steps (by step key): where the step is done.
  "prod:configure-bom": path.to.parts,
  "prod:configure-builtins": path.to.production,
  "prod:purchase-make": path.to.jobs,
  "prod:serialize-sell": path.to.salesOrders
};

const resolveScreenUrl = (appKey: string): string | undefined =>
  SETUP_SCREEN_PATHS[appKey];

// Resolve a training video key (on a nested product step) to a watch URL, via
// the ERP trainingConfig — prefers the Academy course, falls back to the video.
const resolveVideoUrl = (videoKey: string): string | undefined => {
  const video = trainingConfig[videoKey];
  return video?.academyUrl ?? video?.videoUrl;
};

// The hub's own navigation, beside every page under this layout: the pages a
// person uses, and for Carbon staff the hub's settings.
function ImplementationSidebar() {
  const { t } = useLingui();
  const { isInternal } = useFlags();
  const groups: RouteGroup[] = [
    {
      name: t`Implementation`,
      routes: [
        {
          // Staff view anyone's page here; everyone else sees their own.
          name: isInternal ? t`Pages` : t`My Page`,
          to: path.to.implementation,
          icon: <LuUser />,
          isActive: (pathname) => pathname === path.to.implementation
        },
        {
          name: t`Priority Set`,
          to: path.to.implementationPrioritySet,
          icon: <LuListChecks />
        }
      ]
    },
    ...(isInternal
      ? [
          {
            name: t`Carbon Staff`,
            routes: [
              {
                name: t`Settings`,
                to: path.to.implementationSettings,
                icon: <LuSettings />
              }
            ]
          }
        ]
      : [])
  ];
  return <GroupedContentSidebar groups={groups} />;
}

export const handle: Handle = {
  breadcrumb: msg`Implementation`,
  to: path.to.implementation,
  sidebar: ImplementationSidebar
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId, email } = await requirePermissions(
    request,
    {}
  );

  const [hub, flagOn] = await Promise.all([
    getImplementationHub(client, companyId),
    personalPagesEnabled(companyId)
  ]);
  const personalPages = usesPersonalPages(hub.data, flagOn);
  // Carbon staff reach the hub in every company, enrolled or not, and opening
  // it creates nothing. The company's own people reach it only once the
  // company is enrolled: enrolment is when the hub becomes visible to them.
  const access = hubAccess(Boolean(hub.data), isInternalEmail(email));
  if (access === "none") {
    throw redirect(path.to.authenticatedRoot);
  }

  const isStaff = isInternalEmail(email);
  // The company's own people use the layout their company chose. Carbon staff
  // reach this one in any company, to load pages before a switch.
  if (!isStaff && !personalPages) {
    throw redirect(path.to.getStarted);
  }
  const [checkStates, fieldValues, rows, signals, counts, assignments] =
    await Promise.all([
      getImplementationCheckStates(client, companyId),
      getImplementationFieldValues(client, companyId),
      getImplementationRows(client, companyId),
      getImplementationSignals(client, companyId),
      getImplementationCounts(client, companyId),
      getImplementationAssignments(client, companyId)
    ]);

  return {
    // An unenrolled hub shows the settings enrolment would create.
    hub: hub.data
      ? {
          tier: hub.data.tier,
          status: hub.data.status,
          exclusions: hub.data.exclusions as unknown,
          contacts: hub.data.contacts as unknown
        }
      : UNENROLLED_HUB,
    checkStates: checkStates.data ?? [],
    fieldValues: fieldValues.data ?? [],
    rows: rows.data ?? [],
    signals,
    counts,
    assignments: assignments.data ?? [],
    userId,
    // Staff previewing the customer's view (useImplementationPreview).
    previewAsCustomer:
      isStaff && isImplementationPreview(request.headers.get("cookie")),
    // False while staff open the hub of a company not on Personal Pages: only
    // pages and the priority set save until it is. `enrolled` and `flagOn`
    // say why, for the staff notice.
    personalPages,
    enrolled: Boolean(hub.data),
    flagOn
  };
}

export default function ImplementationHubLayout() {
  const { company } = useUser();
  const { isInternal } = useFlags();
  useImplementationRealtime(company.id);
  useRealtimeTable({
    companyId: company.id,
    table: "implementationAssignment"
  });
  useRealtimeTable({ companyId: company.id, table: "implementationMember" });
  // Verified badges name the people who verified (a live list).
  const [allPeople] = usePeople();

  const loaderData = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ success: boolean; message?: string }>();
  const refused = fetcher.data?.success === false ? fetcher.data : undefined;

  // The hub's single write path: every mutation submits to the /state action,
  // which persists + revalidates the loader (server stays the source of truth).
  const dispatch = useCallback(
    (m: HubMutation) =>
      fetcher.submit(toFormFields(m), {
        method: "post",
        action: path.to.implementationState
      }),
    [fetcher]
  );

  const people = useMemo(
    () =>
      allPeople
        .filter((person) => person.active !== false)
        .map((person) => ({
          id: person.id,
          name: person.name,
          avatarUrl: person.avatarUrl
        })),
    [allPeople]
  );

  const hubData = useMemo<HubData>(
    () => ({
      tier: loaderData.hub.tier,
      status: loaderData.hub.status,
      exclusions:
        (loaderData.hub.exclusions as unknown as HubExclusions) ??
        EMPTY_EXCLUSIONS,
      contacts: (loaderData.hub.contacts as unknown as HubContacts) ?? {},
      checkStates: loaderData.checkStates,
      fieldValues: loaderData.fieldValues,
      rows: loaderData.rows as unknown as ImplementationRowData[],
      signals: loaderData.signals,
      counts: loaderData.counts,
      assignments: loaderData.assignments,
      people: people,
      userId: loaderData.userId
    }),
    [loaderData, people]
  );

  // Staff edit a person's page in place unless they preview the customer's
  // view.
  const previewing = useImplementationPreview() && isInternal;
  const flags = useMemo<HubFlags>(
    () => ({ isInternal, previewing, canEdit: isInternal && !previewing }),
    [isInternal, previewing]
  );

  return (
    // Each page owns its scroll and padding: the hub page scrolls a padded
    // column, the priority set is a document page with its own side panel.
    <div className="relative min-w-0 h-[calc(100dvh-var(--topbar-height)-var(--content-inset))] overflow-hidden bg-card">
      <HubProvider
        data={hubData}
        flags={flags}
        dispatch={dispatch}
        resolveScreenUrl={resolveScreenUrl}
        resolveVideoUrl={resolveVideoUrl}
        refused={refused}
      >
        <RecordOutlet />
      </HubProvider>
    </div>
  );
}
