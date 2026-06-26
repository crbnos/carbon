import { requirePermissions } from "@carbon/auth/auth.server";
import {
  EMPTY_EXCLUSIONS,
  gatesDone,
  type HubContacts,
  type HubExclusions,
  type ImplementationRowData,
  SPINE,
  spineForTier,
  stateMap
} from "@carbon/onboarding";
import {
  detectImplementationSignals,
  getImplementationCheckStates,
  getImplementationFieldValues,
  getImplementationHub,
  getImplementationRows
} from "@carbon/onboarding/server";
import {
  type HubData,
  type HubFlags,
  type HubMutation,
  HubProvider,
  toFormFields
} from "@carbon/onboarding/ui";
import { msg } from "@lingui/core/macro";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import {
  Outlet,
  redirect,
  useFetcher,
  useLoaderData,
  useLocation,
  useNavigate
} from "react-router";
import { GroupedContentSidebar } from "~/components/Layout";
import { CollapsibleSidebarProvider } from "~/components/Layout/Navigation";
import { MeshGradientBackground } from "~/components/MeshGradientBackground";
import { useUser } from "~/hooks";
import {
  setCustomerPreview,
  useCustomerPreview
} from "~/hooks/useCustomerPreview";
import { useFlags } from "~/hooks/useFlags";
import { useImplementationRealtime } from "~/hooks/useImplementationRealtime";
import { useImplementationSubmodules } from "~/hooks/useImplementationSubmodules";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { trainingConfig } from "~/utils/training";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Get Started" }];
};

// Deep links from the Setup Map: each setup row's stable key → the ERP screen
// where you configure that thing. Keys without a screen are simply omitted (the
// row renders as plain text). Add an entry here when a new setup row needs a link.
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
  "chart-of-accounts": path.to.chartOfAccounts,
  "default-accounts": path.to.accountingDefaults,
  "cost-centers": path.to.costCenters,
  "payment-terms": path.to.paymentTerms,
  "exchange-rates": path.to.exchangeRates,
  "fiscal-year": path.to.fiscalYears,
  "asset-classes": path.to.assetClasses,
  "scrap-reasons": path.to.scrapReasons,
  "maintenance-schedules": path.to.maintenanceSchedules
};

const resolveScreenUrl = (appKey: string): string | undefined =>
  SETUP_SCREEN_PATHS[appKey];

// Resolve a training video key (on a nested product step) to a watch URL, via
// the ERP trainingConfig — prefers the Academy course, falls back to the video.
const resolveVideoUrl = (videoKey: string): string | undefined => {
  const video = trainingConfig[videoKey];
  return video?.academyUrl ?? video?.videoUrl;
};

export const handle: Handle = {
  breadcrumb: msg`Get Started`,
  to: path.to.getStarted
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const hub = await getImplementationHub(client, companyId);
  // Only enrolled companies have a hub row — others never reach this surface.
  // Enrollment is the gate (manual today; Cloud auto-enroll later), not staff.
  if (!hub.data) {
    throw redirect(path.to.authenticatedRoot);
  }

  const [checkStates, fieldValues, rows, signals] = await Promise.all([
    getImplementationCheckStates(client, companyId),
    getImplementationFieldValues(client, companyId),
    getImplementationRows(client, companyId),
    detectImplementationSignals(client, companyId)
  ]);

  return {
    hub: hub.data,
    checkStates: checkStates.data ?? [],
    fieldValues: fieldValues.data ?? [],
    rows: rows.data ?? [],
    signals
  };
}

export default function GetStartedLayout() {
  const { company } = useUser();
  const { isInternal } = useFlags();
  const previewingAsCustomer = useCustomerPreview();
  useImplementationRealtime(company.id);
  const { groups } = useImplementationSubmodules();

  const loaderData = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const location = useLocation();

  // When the customer clears the final checkpoint anywhere (typically the Plan),
  // send them to the command center so they land on the confetti + the exit
  // dialog. Session-only: the ref seeds from the current value so a reload while
  // already complete doesn't re-fire, and an exited hub (status "complete") is
  // skipped entirely.
  const spine = spineForTier(SPINE, loaderData.hub.tier);
  const allPhasesDone =
    spine.length > 0 &&
    gatesDone(spine, stateMap(loaderData.checkStates), loaderData.signals) ===
      spine.length;
  const wasAllDone = useRef(allPhasesDone);
  useEffect(() => {
    if (
      allPhasesDone &&
      !wasAllDone.current &&
      loaderData.hub.status !== "complete" &&
      location.pathname !== path.to.getStarted
    ) {
      navigate(path.to.getStarted, { state: { justCompleted: true } });
    }
    wasAllDone.current = allPhasesDone;
  }, [allPhasesDone, loaderData.hub.status, location.pathname, navigate]);

  // The hub's single write path: every mutation submits to the /state action,
  // which persists + revalidates the loader (server stays the source of truth).
  const dispatch = useCallback(
    (m: HubMutation) =>
      fetcher.submit(toFormFields(m), {
        method: "post",
        action: path.to.getStartedState
      }),
    [fetcher]
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
      signals: loaderData.signals
    }),
    [loaderData]
  );

  const flags = useMemo<HubFlags>(
    () => ({
      isInternal,
      previewing: previewingAsCustomer,
      canEdit: isInternal && !previewingAsCustomer
    }),
    [isInternal, previewingAsCustomer]
  );

  return (
    <CollapsibleSidebarProvider>
      <div className="grid grid-cols-[auto_1fr] grid-rows-[minmax(0,1fr)] w-full h-full overflow-hidden">
        <GroupedContentSidebar groups={groups} exactMatch />
        <div className="relative min-w-0 overflow-hidden">
          <MeshGradientBackground theme="blue" />
          <div className="relative z-10 h-full overflow-y-auto">
            {isInternal ? (
              <PreviewBar previewing={previewingAsCustomer} />
            ) : null}
            <div className="p-8">
              <HubProvider
                data={hubData}
                flags={flags}
                dispatch={dispatch}
                resolveScreenUrl={resolveScreenUrl}
                resolveVideoUrl={resolveVideoUrl}
              >
                <Outlet />
              </HubProvider>
            </div>
          </div>
        </div>
      </div>
    </CollapsibleSidebarProvider>
  );
}

// Internal-only bar: enter or exit the customer preview. State lives in
// sessionStorage (useCustomerPreview), so toggling is a button, not navigation —
// it persists across pages + reloads without a URL param.
function PreviewBar({ previewing }: { previewing: boolean }) {
  if (previewing) {
    return (
      <div className="sticky top-0 z-20 flex items-center gap-3 px-8 py-2 bg-amber-500/15 border-b border-amber-500/20 text-sm backdrop-blur-sm">
        <span className="text-amber-700 dark:text-amber-400 font-medium">
          Customer preview
        </span>
        <span className="text-muted-foreground">
          Internal pages and locked fields are hidden.
        </span>
        <button
          type="button"
          onClick={() => setCustomerPreview(false)}
          className="ml-auto font-medium text-amber-700 dark:text-amber-400 hover:underline"
        >
          Exit preview
        </button>
      </div>
    );
  }
  return (
    <div className="sticky top-0 z-20 flex items-center justify-end px-8 py-2">
      <button
        type="button"
        onClick={() => setCustomerPreview(true)}
        className="text-xs font-medium text-muted-foreground hover:text-foreground rounded-full border bg-card px-3 py-1 shadow-button-base"
      >
        Preview as customer
      </button>
    </div>
  );
}
