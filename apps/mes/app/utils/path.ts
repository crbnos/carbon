import { getAppUrl, getMESUrl, SUPABASE_URL } from "@carbon/auth";
import { generatePath } from "react-router";

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
      failureModes: `${api}/failure-modes`,
      serialNumbers: (itemId: string) =>
        generatePath(`${api}/serial-numbers?itemId=${itemId}`)
    },
    file: {
      jobTraveler: (id: string) => `${getAppUrl()}${file}/traveler/${id}.pdf`,
      operationLabelsPdf: (
        id: string,
        {
          labelSize,
          trackedEntityId
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
          trackedEntityId
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
      trackedEntityLabelZpl: (
        id: string,
        { labelSize }: { labelSize?: string } = {}
      ) => {
        let url = `${file}/entity/${id}/labels.zpl`;
        const params = new URLSearchParams();

        if (labelSize) params.append("labelSize", labelSize);

        const queryString = params.toString();
        if (queryString) url += `?${queryString}`;

        return generatePath(url);
      },
      trackedEntityLabelPdf: (
        id: string,
        { labelSize }: { labelSize?: string } = {}
      ) => {
        let url = `${file}/entity/${id}/labels.pdf`;
        const params = new URLSearchParams();

        if (labelSize) params.append("labelSize", labelSize);

        const queryString = params.toString();
        if (queryString) url += `?${queryString}`;

        return generatePath(url);
      }
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
    convertEntity: (id: string) => generatePath(`${x}/entity/${id}/convert`),
    endShift: `${x}/end-shift`,
    endOperation: (id: string) => generatePath(`${x}/end/${id}`),
    feedback: `${x}/feedback`,
    finish: `${x}/finish`,
    health: "/health",
    kanbanComplete: (id: string) => `${ERP_URL}/api/kanban/complete/${id}`,
    inspectionSteps: `${x}/steps/inspection`,
    inventoryAdjustment: `${x}/adjustment`,
    issue: `${x}/issue`,
    issueTrackedEntity: `${x}/issue-tracked-entity`,
    location: `${x}/location`,
    login: "/login",
    logout: "/logout",
    maintenance: `${x}/maintenance`,
    maintenanceDetail: (id: string) => generatePath(`${x}/dispatch/${id}`),
    maintenanceDispatchItem: (id: string) =>
      generatePath(`${x}/dispatch/${id}/item`),
    addAndIssueMaintenanceDispatchItem: (dispatchId: string) =>
      generatePath(`${x}/dispatch/${dispatchId}/add-and-issue`),
    maintenanceEvent: `${x}/maintenance-event`,
    messagingNotify: `${x}/proxy/api/messaging/notify`,
    newMaintenanceDispatch: `${x}/dispatch/new`,
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
    scrapEntity: (operationId: string, id: string, parentId?: string) => {
      const basePath = generatePath(`${x}/entity/${operationId}/${id}/scrap`);
      return parentId ? `${basePath}?parentId=${parentId}` : basePath;
    },
    startOperation: (id: string) => generatePath(`${x}/start/${id}`),
    switchCompany: (companyId: string) =>
      generatePath(`${x}/company/switch/${companyId}`),
    suggestion: `${x}/suggestion`,
    unconsume: `${x}/unconsume`,
    workCenter: (workCenter: string) =>
      generatePath(`${x}/operations/${workCenter}`),
    itemMaster: (itemId: string, type: string) =>
      `${getAppUrl()}${x}/${type.toLowerCase()}/${itemId}/view/details`,
    jobDetail: (id: string) => `${getAppUrl()}${x}/job/${id}/details`
  }
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
