import {
  filterReportPinsByVisibleEntries,
  filterSavedViewsByVisibleReportKeys,
  getVisibleReportCatalog
} from "~/modules/accounting/ui/Reports/reportCatalog";

const reportsHubLoaderVisibility = {
  role: "employee" as const,
  viewPermissions: ["accounting"] as const
};

export function getReportsHubVisibleCatalog() {
  return getVisibleReportCatalog(reportsHubLoaderVisibility);
}

export function getSerializedReportsHubData<
  TPin extends { reportKey: string },
  TView extends { id: string; reportKey: string }
>(args: {
  currentUserId: string;
  pinOverrides: readonly TPin[];
  savedViews: readonly TView[];
  visibleReports?: readonly { key: string }[];
}) {
  const visibleReports = args.visibleReports ?? getReportsHubVisibleCatalog();
  const savedViews = filterSavedViewsByVisibleReportKeys({
    savedViews: args.savedViews,
    visibleReports
  });
  const pinOverrides = filterReportPinsByVisibleEntries({
    pins: args.pinOverrides,
    visibleReports,
    savedViews
  });

  return {
    currentUserId: args.currentUserId,
    pinOverrides,
    savedViews
  };
}
