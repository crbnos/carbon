import { getAppUrl, SUPABASE_URL } from "@carbon/auth";
import { generatePath } from "@remix-run/react";

const x = "/x"; // from ~/routes/x+ folder

const ERP_URL = getAppUrl();

export const path = {
  to: {
    authenticatedRoot: x,
    accountSettings: `${ERP_URL}/x/account`,
    callback: "/callback",
    companySwitch: (companyId: string) =>
      generatePath(`${x}/company/switch/${companyId}`),
    dashboard: `${ERP_URL}/x`,

    healthcheck: "/healthcheck",
    login: "/login",
    logout: "/logout",
    refreshSession: "/refresh-session",
    requestAccess: "/request-access",
    root: "/",
  },
} as const;

export const removeSubdomain = (url?: string): string => {
  if (!url) return "localhost:3000";
  const parts = url.split("/")[0].split(".");

  const domain = parts.slice(-2).join(".");

  return domain;
};

export const getStoragePath = (bucket: string, path: string) => {
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
};

export const requestReferrer = (request: Request) => {
  return request.headers.get("referer");
};

export const getParams = (request: Request) => {
  const url = new URL(requestReferrer(request) ?? "");
  const searchParams = new URLSearchParams(url.search);
  return searchParams.toString();
};
