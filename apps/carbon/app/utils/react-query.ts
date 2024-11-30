import { remember } from "@epic-web/remember";
import { QueryClient, queryOptions } from "@tanstack/react-query";
import * as cookie from "cookie";

export const queryClient = remember("react-query", () => new QueryClient());

enum RefreshRate {
  Never = Infinity,
  High = 1000 * 60 * 2,
  Medium = 1000 * 60 * 10,
  Low = 1000 * 60 * 30,
}

export const getCompanyId = () => {
  const cookieHeader = document.cookie;
  const parsed = cookieHeader ? cookie.parse(cookieHeader)["companyId"] : null;
  return parsed;
};

export const countriesQuery = () =>
  queryOptions({
    queryKey: ["countries"],
    staleTime: RefreshRate.Never,
  });

export const uomsQuery = (companyId: string) =>
  queryOptions({
    queryKey: ["uoms", companyId],
    staleTime: RefreshRate.Medium,
  });
