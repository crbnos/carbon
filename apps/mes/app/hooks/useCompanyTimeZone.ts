import { useRouteData } from "@carbon/react";
import { path } from "~/utils/path";

/**
 * The company's IANA timezone — the ledger calendar. Falls back to UTC before
 * the layout route data is available.
 */
export function useCompanyTimeZone(): string {
  const data = useRouteData<{ company: { timezone?: string | null } }>(
    path.to.authenticatedRoot
  );
  return data?.company?.timezone ?? "UTC";
}

/**
 * The operational timezone of the current location (scheduling, shifts, MES
 * day-grouping). A location with a null/empty timezone inherits the company's,
 * matching the server-side getLocationTimeZone resolution.
 */
export function useLocationTimeZone(): string {
  const data = useRouteData<{
    company: { timezone?: string | null };
    location: string | null;
    locations: { id: string; timezone: string | null }[];
  }>(path.to.authenticatedRoot);
  const current = data?.locations?.find((l) => l.id === data?.location);
  return current?.timezone || data?.company?.timezone || "UTC";
}
