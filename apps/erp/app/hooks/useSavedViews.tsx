import { useRouteData } from "@carbon/remix";
import { path } from "~/utils/path";
import type { SavedView } from "~/modules/shared/types";

type SavedViews = SavedView[];

export function useSavedViews(): {
  savedViews: SavedViews;
} {
  const data = useRouteData<{
    savedViews: unknown;
  }>(path.to.authenticatedRoot);

  const savedViews =
    data?.savedViews && isSavedViews(data.savedViews) ? data.savedViews : [];

  return {
    savedViews,
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
