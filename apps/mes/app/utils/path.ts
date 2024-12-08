import { getAppUrl, SUPABASE_API_URL } from "@carbon/auth";
import { generatePath } from "@remix-run/react";

export const ERP_URL = getAppUrl();

const x = "/x";
const api = "/api";
const file = `/file`;

export const path = {
  to: {
    api: {
      autodeskToken: `${api}/autodesk/token`,
    },
    file: {
      previewImage: (bucket: string, path: string) =>
        generatePath(`${file}/preview/image?file=${bucket}/${path}`),
      previewFile: (path: string) => generatePath(`${file}/preview/${path}`),
    },
    accountSettings: `${ERP_URL}/x/account`,
    active: `${x}/active`,
    authenticatedRoot: x,
    callback: "/callback",
    complete: `${x}/complete`,
    endShift: `${x}/end-shift`,
    feedback: `${x}/feedback`,
    finish: `${x}/finish`,
    forgotPassword: `${ERP_URL}/forgot-password`,
    healthcheck: "/healthcheck",
    issue: `${x}/issue`,
    operation: (id: string) => generatePath(`${x}/operation/${id}`),
    operations: `${x}/operations?saved=1`,
    location: `${x}/location`,
    login: "/login",
    logout: "/logout",
    productionEvent: `${x}/event`,
    recent: `${x}/recent`,
    refreshSession: "/refresh-session",
    requestAccess: "/request-access",
    rework: `${x}/rework`,
    root: "/",
    scrap: `${x}/scrap`,
    scrapReasons: `${api}/scrap-reasons`,
    switchCompany: (companyId: string) =>
      generatePath(`${x}/company/switch/${companyId}`),
    workCenter: (workCenter: string) =>
      generatePath(`${x}/operations/${workCenter}`),
  },
} as const;

export const removeSubdomain = (url?: string): string => {
  if (!url) return "localhost:3000";
  const parts = url.split("/")[0].split(".");

  const domain = parts.slice(-2).join(".");

  return domain;
};

export const getPrivateUrl = (path: string) => {
  return `/file/preview/private/${path}`;
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
