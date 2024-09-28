import { SUPABASE_API_URL } from "@carbon/auth";
import { generatePath } from "@remix-run/react";

export const ERP_URL =
  process.env.NODE_ENV === "development"
    ? "http://localhost:3000"
    : `https://app.carbonos.dev`;

const x = "/x"; // from ~/routes/x+ folder

export const path = {
  to: {
    accountSettings: `${ERP_URL}/x/account`,
    authenticatedRoot: x,
    callback: "/callback",
    forgotPassword: "/forgot-password",
    healthcheck: "/healthcheck",
    jobs: (workCenter: string) => generatePath(`${x}/jobs/${workCenter}`),
    location: `${x}/location`,
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
  return `${SUPABASE_API_URL}/storage/v1/object/public/${bucket}/${path}`;
};

export const requestReferrer = (request: Request) => {
  return request.headers.get("referer");
};

export const getParams = (request: Request) => {
  const url = new URL(requestReferrer(request) ?? "");
  const searchParams = new URLSearchParams(url.search);
  return searchParams.toString();
};
