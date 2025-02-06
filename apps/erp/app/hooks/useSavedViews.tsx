import { useRouteData, useUrlParams } from "@carbon/remix";
import { path } from "~/utils/path";
import type { SavedView } from "~/modules/shared/types";

type SavedViews = SavedView[];

export function useSavedViews(): {
  currentView: SavedView | null;
  hasView: boolean;
  savedViews: SavedViews;
  view: string | null;
} {
  const [params] = useUrlParams();
  const view = params.get("view");

  const data = useRouteData<{
    savedViews: unknown;
  }>(path.to.authenticatedRoot);

  const savedViews =
    data?.savedViews && isSavedViews(data.savedViews) ? data.savedViews : [];

  const currentView = savedViews.find((v) => v.id === view) ?? null;

  return {
    currentView,
    hasView: currentView !== null,
    savedViews,
    view,
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
