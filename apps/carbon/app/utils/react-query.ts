import { remember } from "@epic-web/remember";
import { QueryClient, queryOptions } from "@tanstack/react-query";
import * as cookie from "cookie";

export const queryClient = remember("react-query", () => new QueryClient());

export const getCompanyId = () => {
  const cookieHeader = document.cookie;
  const parsed = cookieHeader ? cookie.parse(cookieHeader)["companyId"] : null;
  return parsed;
};

export const countriesQuery = () =>
  queryOptions({
    queryKey: ["countries"],
    staleTime: Infinity,
  });

export const uomsQuery = (companyId: string) =>
  queryOptions({
    queryKey: ["uoms", companyId],
    staleTime: Infinity,
  });
