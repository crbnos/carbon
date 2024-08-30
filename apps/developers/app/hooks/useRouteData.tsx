import { useMatches } from "@remix-run/react";
import { useMemo } from "react";

export function useRouteData<T>(path: string): T | undefined {
  const matchingRoutes = useMatches();
  const route = useMemo(
    () => matchingRoutes.find((route) => route.pathname === path),
    [matchingRoutes, path]
  );
  return (route?.data as T) || undefined;
}
