import { useRouteData, useUrlParams } from "@carbon/remix";
import { path } from "~/utils/path";
import type { SavedView } from "~/modules/shared/types";
import type { Route } from "~/types";

type SavedViews = SavedView[];

export function useSavedViews(): {
  currentView: SavedView | null;
  hasView: boolean;
  savedViews: SavedViews;
  view: string | null;
  addSavedViewsToRoutes: (route: Route) => Route;
} {
  const [params] = useUrlParams();
  const view = params.get("view");

  const data = useRouteData<{
    savedViews: unknown;
  }>(path.to.authenticatedRoot);

  const savedViews =
    data?.savedViews && isSavedViews(data.savedViews) ? data.savedViews : [];

  const currentView = savedViews.find((v) => v.id === view) ?? null;

  const addSavedViewsToRoutes = (route: Route) => ({
    ...route,
    views: savedViews
      .filter((view) => view.table === route.table)
      .map((view) => ({
        ...view,
        to: `${route.to}?view=${view.id}${
          view.filters?.length ? `&filter=${view.filters.join("&filter=")}` : ""
        }${view.sorts?.length ? `&sort=${view.sorts.join("&sort=")}` : ""}`,
      })),
  });

  return {
    currentView,
    hasView: currentView !== null,
    savedViews,
    view,
    addSavedViewsToRoutes,
  };
}

function isSavedViews(value: any): value is SavedViews {
  return (
    Array.isArray(value) &&
    value.every(
      (view) =>
        Array.isArray(view.columnOrder) &&
        typeof view.columnPinning === "object" &&
        typeof view.columnVisibility === "object" &&
        typeof view.name === "string" &&
        typeof view.table === "string" &&
        typeof view.id === "string" &&
        (view.sorts === undefined || Array.isArray(view.sorts)) &&
        (view.filters === undefined || Array.isArray(view.filters))
    )
  );
}
