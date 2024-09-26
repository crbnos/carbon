import { useMemo } from "react";
import { useMatches } from "react-router-dom";

export function useRouteData<T>(path: string): T | undefined {
  const matchingRoutes = useMatches();
  const route = useMemo(
    () => matchingRoutes.find((route) => route.pathname === path),
    [matchingRoutes, path]
  );
  return (route?.data as T) || undefined;
}
