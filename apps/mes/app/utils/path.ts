import { getAppUrl, getMESUrl, SUPABASE_URL } from "@carbon/auth";
import { generatePath } from "@remix-run/react";

export const ERP_URL = getAppUrl();
export const MES_URL = getMESUrl();

const x = "/x";
const api = "/api";
const file = `/file`;

export const path = {
  to: {
    api: {
      batchNumbers: (itemId: string) =>
        generatePath(`${api}/batch-numbers?itemId=${itemId}`),
      serialNumbers: (itemId: string) =>
        generatePath(`${api}/serial-numbers?itemId=${itemId}`),
    },
    file: {
      jobTraveler: (id: string) => `${getAppUrl()}${file}/traveler/${id}.pdf`,
      operationLabelsPdf: (
        id: string,
        {
          labelSize,
          trackedEntityId,
        }: { labelSize?: string; trackedEntityId?: string } = {}
      ) => {
        let url = `${file}/operation/${id}/labels.pdf`;
        const params = new URLSearchParams();

        if (labelSize) params.append("labelSize", labelSize);
        if (trackedEntityId) params.append("trackedEntityId", trackedEntityId);

        const queryString = params.toString();
        if (queryString) url += `?${queryString}`;

        return generatePath(url);
      },
      operationLabelsZpl: (
        id: string,
        {
          labelSize,
          trackedEntityId,
        }: { labelSize?: string; trackedEntityId?: string } = {}
      ) => {
        let url = `${file}/operation/${id}/labels.zpl`;
        const params = new URLSearchParams();

        if (labelSize) params.append("labelSize", labelSize);
        if (trackedEntityId) params.append("trackedEntityId", trackedEntityId);

        const queryString = params.toString();
        if (queryString) url += `?${queryString}`;

        return generatePath(url);
      },
      previewImage: (bucket: string, path: string) =>
        generatePath(`${file}/preview/image?file=${bucket}/${path}`),
      previewFile: (path: string) => generatePath(`${file}/preview/${path}`),
    },
    accountSettings: `${ERP_URL}/x/account`,
    acknowledge: `${x}/acknowledge`,
    active: `${x}/active`,
    assigned: `${x}/assigned`,
    authenticatedRoot: x,
    callback: "/callback",
    companySwitch: (companyId: string) =>
      generatePath(`${x}/company/switch/${companyId}`),
    complete: `${x}/complete`,
    endShift: `${x}/end-shift`,
    endOperation: (id: string) => generatePath(`${x}/end/${id}`),
    feedback: `${x}/feedback`,
    finish: `${x}/finish`,
    health: "/health",
    kanbanComplete: (id: string) => `${ERP_URL}/api/kanban/complete/${id}`,
    inventoryAdjustment: `${x}/adjustment`,
    issue: `${x}/issue`,
    issueTrackedEntity: `${x}/issue-tracked-entity`,
    location: `${x}/location`,
    login: "/login",
    logout: "/logout",
    messagingNotify: `${x}/proxy/api/messaging/notify`,
    onboarding: `${ERP_URL}/onboarding`,
    operation: (id: string) => generatePath(`${x}/operation/${id}`),
    operations: `${x}/operations?saved=1`,
    productionEvent: `${x}/event`,
    recent: `${x}/recent`,
    record: `${x}/record`,
    recordDelete: (id: string) => generatePath(`${x}/record/${id}/delete`),
    refreshSession: "/refresh-session",
    requestAccess: "/request-access",
    rework: `${x}/rework`,
    root: "/",
    scrap: `${x}/scrap`,
    scrapReasons: `${api}/scrap-reasons`,
    startOperation: (id: string) => generatePath(`${x}/start/${id}`),
    switchCompany: (companyId: string) =>
      generatePath(`${x}/company/switch/${companyId}`),
    unconsume: `${x}/unconsume`,
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
