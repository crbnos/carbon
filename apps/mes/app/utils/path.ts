import { getAppUrl, getMESUrl, SUPABASE_URL } from "@carbon/auth";
import { generatePath } from "react-router";

export const ERP_URL = getAppUrl();
export const MES_URL = getMESUrl();

const x = "/x";
const api = "/api";
const file = `/file`;

export const path = {
  to: {
    accountSettings: `${ERP_URL}/x/account`,
    acknowledge: `${x}/acknowledge`,
    active: `${x}/active`,
    addAndIssueMaintenanceDispatchItem: (dispatchId: string) =>
      generatePath(`${x}/dispatch/${dispatchId}/add-and-issue`),
    api: {
      batchNumbers: (itemId: string) =>
        generatePath(`${api}/batch-numbers?itemId=${itemId}`),
      failureModes: `${api}/failure-modes`,
      modelArtifacts: (modelUploadId: string) =>
        generatePath(`${api}/model/artifacts/${modelUploadId}`),
      pickedAllocation: (jobMaterialId: string) =>
        generatePath(`${api}/picked-allocation?jobMaterialId=${jobMaterialId}`),
      qualityIssueTypes: `${api}/quality-issue-types`,
      serialNumbers: (itemId: string) =>
        generatePath(`${api}/serial-numbers?itemId=${itemId}`),
      suggestedAllocation: (
        itemId: string,
        locationId: string,
        quantity: number
      ) =>
        generatePath(
          `${api}/suggested-allocation?itemId=${itemId}&locationId=${locationId}&quantity=${quantity}`
        )
    },
    assigned: `${x}/assigned`,
    authenticatedRoot: x,
    callback: "/callback",
    companySwitch: (companyId: string) =>
      generatePath(`${x}/company/switch/${companyId}`),
    complete: `${x}/complete`,
    consolePinIn: `${x}/console/pin-in`,
    consolePinOut: `${x}/console/pin-out`,
    consoleToggle: `${x}/console/toggle`,
    convertEntity: (id: string) => generatePath(`${x}/entity/${id}/convert`),
    endOperation: (id: string) => generatePath(`${x}/end/${id}`),
    endShift: `${x}/end-shift`,
    feedback: `${x}/feedback`,
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
      previewFile: (path: string) => generatePath(`${file}/preview/${path}`),
      previewImage: (bucket: string, path: string) =>
        generatePath(`${file}/preview/image?file=${bucket}/${path}`),
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
      },
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
      }
    },
    finish: `${x}/finish`,
    health: "/health",
    inspectionSteps: `${x}/steps/inspection`,
    inventoryAdjustment: `${x}/adjustment`,
    issue: `${x}/issue`,
    issueTrackedEntity: `${x}/issue-tracked-entity`,
    itemMaster: (itemId: string, type: string) =>
      `${getAppUrl()}${x}/${type.toLowerCase()}/${itemId}/details`,
    jobDag: (id: string) => generatePath(`${x}/job/${id}`),
    jobDetail: (id: string) => `${getAppUrl()}${x}/job/${id}/details`,
    jobs: `${x}/jobs`,
    kanbanComplete: (id: string) => `${ERP_URL}/api/kanban/complete/${id}`,
    location: `${x}/location`,
    login: "/login",
    logout: "/logout",
    maintenance: `${x}/maintenance`,
    maintenanceDetail: (id: string) => generatePath(`${x}/dispatch/${id}`),
    maintenanceDispatchItem: (id: string) =>
      generatePath(`${x}/dispatch/${id}/item`),
    maintenanceEvent: `${x}/maintenance-event`,
    manualPrint: `${x}/print`,
    messagingNotify: `${x}/proxy/api/messaging/notify`,
    newMaintenanceDispatch: `${x}/dispatch/new`,
    onboarding: `${ERP_URL}/onboarding`,
    operation: (id: string) => generatePath(`${x}/operation/${id}`),
    operations: `${x}/operations?saved=1`,
    picking: `${x}/picking`,
    pickingDetail: (id: string) => generatePath(`${x}/picking/${id}`),
    pickingLineQuantity: (id: string) =>
      generatePath(`${x}/picking/${id}/line/quantity`),
    pickingStatus: (id: string) => generatePath(`${x}/picking/${id}/status`),
    pickingTracked: (id: string, lineId: string) =>
      generatePath(`${x}/picking/${id}/tracked/${lineId}`),
    printingSettings: `${ERP_URL}/x/settings/printing`,
    productionEvent: `${x}/event`,
    qualityIssueNew: `${x}/quality-issue/new`,
    recent: `${x}/recent`,
    record: `${x}/record`,
    recordDelete: (id: string) => generatePath(`${x}/record/${id}/delete`),
    refreshSession: "/refresh-session",
    requestAccess: "/request-access",
    rework: `${x}/rework`,
    reworkTargets: (operationId: string) =>
      generatePath(`${x}/rework-targets/${operationId}`),
    root: "/",
    scrap: `${x}/scrap`,
    scrapEntity: (operationId: string, id: string, parentId?: string) => {
      const basePath = generatePath(`${x}/entity/${operationId}/${id}/scrap`);
      return parentId ? `${basePath}?parentId=${parentId}` : basePath;
    },
    scrapReasons: `${api}/scrap-reasons`,
    startOperation: (id: string) => generatePath(`${x}/start/${id}`),
    suggestion: `${x}/suggestion`,
    switchCompany: (companyId: string) =>
      generatePath(`${x}/company/switch/${companyId}`),
    timeCardPage: `${x}/timecard`,
    timecard: `${api}/timecard`,
    triggerRework: `${x}/trigger-rework`,
    unconsume: `${x}/unconsume`,
    workCenter: (workCenter: string) =>
      generatePath(`${x}/operations/${workCenter}`)
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

// Raw model source for the viewer's WASM fallback tier — the bucket varies
// (temp-staging for current uploads, private for pre-assembler rows).
export const getRawModelUrl = (bucket: string, path: string) => {
  return `/file/preview/${bucket}/${path}`;
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
