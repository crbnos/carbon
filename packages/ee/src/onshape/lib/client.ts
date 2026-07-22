// From @carbon/env directly (not the @carbon/auth root barrel, which pulls in
// React UI code with top-level await and breaks non-bundler tooling — scripts,
// test runners — that imports this client).

import type { Database } from "@carbon/database";
import { ONSHAPE_CLIENT_ID, ONSHAPE_CLIENT_SECRET } from "@carbon/env";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import axios from "axios";
import type { OnshapeDocument } from "./document.type";
import type { OnshapeElementType } from "./element.type";

const logger = getLogger("ee", "onshape");

interface OnshapeClientConfig {
  baseUrl: string;
  accessToken: string;
}

export interface OnshapePart {
  id: string;
  name: string;
  partNumber: string;
  revision: string;
  description: string;
  metadata: Record<string, string>;
}

export interface OnshapeCompany {
  id: string;
  name?: string;
  [key: string]: unknown;
}

// The only export formats Carbon ingests: GLTF for models (compressed to a
// viewer-renderable GLB before attaching) and PDF for drawings. Onshape's API
// supports more (STEP, PARASOLID, IGES, ...) but they are deliberately not
// accepted here — real assemblies export to multi-GB STEP files, and Onshape
// stays the CAD system of record.
export type OnshapeModelTranslationFormat = "GLTF";
export type OnshapeDrawingTranslationFormat = "PDF";

// Tessellation presets Onshape accepts for mesh exports (mirrors the UI's
// resolution picker). Mesh translations fail without one.
export type OnshapeMeshResolution = "coarse" | "medium" | "fine";

// Async translation job (GLTF / PDF export). requestState transitions
// ACTIVE -> DONE | FAILED. When storeInDocument=false the result is fetched via
// resultExternalDataIds; when true, via resultElementIds (a blob element).
export interface OnshapeTranslation {
  id: string;
  requestState?: "ACTIVE" | "DONE" | "FAILED" | string;
  resultExternalDataIds?: string[] | null;
  resultElementIds?: string[] | null;
  resultDocumentId?: string | null; // download external data FROM this document
  failureReason?: string | null;
  [key: string]: unknown;
}

// A released revision (company revisions API). elementType is NUMERIC:
// 0 = Part Studio, 1 = Assembly, 2 = Drawing. Carries the released version's
// documentId/versionId/elementId — the join to a Carbon item is by partNumber.
export interface OnshapeRevision {
  partNumber: string;
  revision: string;
  elementType: number;
  documentId: string;
  versionId: string;
  elementId: string;
  partId?: string | null;
  mimeType?: string;
  name?: string;
  releaseId?: string;
  releaseName?: string;
  isObsolete?: boolean;
  [key: string]: unknown;
}

// Typed API error so callers can detect rate limiting (status 429) and honor
// Retry-After instead of hammering the quota.
export class OnshapeApiError extends Error {
  status?: number;
  retryAfterSeconds?: number;

  constructor(message: string, status?: number, retryAfterSeconds?: number) {
    super(message);
    this.name = "OnshapeApiError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// Thrown when a translation result exceeds the caller's size cap — large
// assemblies export far beyond what Carbon's storage accepts or its browser
// viewer can render — so callers skip the asset (permanently: retrying can't
// shrink it) instead of failing the sync.
export class OnshapeAssetTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OnshapeAssetTooLargeError";
  }
}

export class OnshapeClient {
  private baseUrl: string;
  private accessToken: string;
  private axiosInstance: ReturnType<typeof axios.create>;

  constructor(config: OnshapeClientConfig) {
    this.baseUrl = config.baseUrl;
    this.accessToken = config.accessToken;

    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      headers: this.getAuthHeaders(),
      // Bound every request so a slow/unresponsive Onshape can't hang callers
      // indefinitely (e.g. webhook reconcile during the settings-save request).
      timeout: 60_000
    });
  }

  private getAuthHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "application/json;charset=UTF-8; qs=0.09",
      Authorization: `Bearer ${this.accessToken}`
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    try {
      const response = await this.axiosInstance.request<T>({
        method,
        url: path,
        data: body
      });
      return response.data;
    } catch (error) {
      throw this.toApiError(error);
    }
  }

  private toApiError(error: unknown): Error {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      // No response => network error / timeout / DNS / ECONNREFUSED. Keep axios's
      // own message (e.g. "timeout of 60000ms exceeded") instead of the useless
      // "Onshape API error (undefined): undefined".
      if (status === undefined) {
        return new OnshapeApiError(`Onshape request failed: ${error.message}`);
      }
      const parsedRetryAfter = Number(error.response?.headers?.["retry-after"]);
      return new OnshapeApiError(
        `Onshape API error (${status}): ${
          typeof error.response?.data === "string"
            ? error.response.data
            : JSON.stringify(error.response?.data)
        }`,
        status,
        Number.isFinite(parsedRetryAfter) ? parsedRetryAfter : undefined
      );
    }
    return error instanceof Error ? error : new Error(String(error));
  }

  async getDocuments(limit: number = 20, offset: number = 0): Promise<any> {
    return this.request(
      "GET",
      `/api/v10/documents?limit=${limit}&offset=${offset}`
    );
  }

  // The authenticated principal's Onshape companies — used to resolve the company
  // id for the revisions API. Returns { items: [...] } in practice, but handled
  // defensively (array | { items }). If a token ever spans multiple companies,
  // resolve/choose explicitly rather than trusting [0].
  async getCompanies(): Promise<OnshapeCompany[]> {
    const response = await this.request<
      OnshapeCompany[] | { items?: OnshapeCompany[] }
    >("GET", "/api/v10/companies");
    return Array.isArray(response) ? response : (response.items ?? []);
  }

  // Register a webhook subscription so Onshape POSTs lifecycle events to Carbon.
  // Used to subscribe to onshape.revision.created (go-forward asset sync) on
  // connect. Requires a publicly reachable callback URL and an OAuth app that
  // permits webhook management. The API also REQUIRES `options` and a scope
  // (`companyId` or `documentId`) — omitting either is a 400 ("options field is
  // required" / "company id or document id required").
  async createWebhook(params: {
    url: string;
    events: string[];
    companyId: string; // Onshape company id — scopes the subscription
    collapseEvents?: boolean;
  }): Promise<{ id: string } & Record<string, unknown>> {
    return this.request<{ id: string } & Record<string, unknown>>(
      "POST",
      "/api/v10/webhooks",
      {
        url: params.url,
        events: params.events,
        companyId: params.companyId,
        options: { collapseEvents: params.collapseEvents ?? false }
      }
    );
  }

  // List the webhook subscriptions visible to the authenticated principal. Used
  // on disconnect to find (and delete) the ones Carbon registered.
  async getWebhooks(): Promise<{
    items?: Array<{ id: string; url: string } & Record<string, unknown>>;
  }> {
    return this.request<{
      items?: Array<{ id: string; url: string } & Record<string, unknown>>;
    }>("GET", "/api/v10/webhooks");
  }

  // Delete a webhook subscription (called on disconnect so a dead callback isn't
  // left registered).
  async deleteWebhook(webhookId: string): Promise<void> {
    await this.request<unknown>("DELETE", `/api/v10/webhooks/${webhookId}`);
  }

  async getVersions(
    documentId: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<any> {
    return this.request(
      "GET",
      `/api/v10/documents/d/${documentId}/versions?limit=${limit}&offset=${offset}`
    );
  }

  async getElements(
    document: OnshapeDocument,
    elementType?: OnshapeElementType
  ): Promise<any> {
    return this.request(
      "GET",
      `/api/v10/documents/d/${document.documentId}/${document.wvm}/${document.wvmId}/elements${elementType ? "?elementType=" + elementType : ""}`
    );
  }

  async getBillOfMaterials(
    documentId: string,
    versionId: string,
    elementId: string
  ): Promise<any> {
    return this.request(
      "GET",
      `/api/v10/assemblies/d/${documentId}/v/${versionId}/e/${elementId}/bom?indented=true&multiLevel=true&generateIfAbsent=true&onlyVisibleColumns=true&includeItemMicroversions=false&includeTopLevelAssemblyRow=true&thumbnail=false`
    );
  }

  // Released revisions for a part number (company-scoped). elementType is NUMERIC
  // (0 Part Studio / 1 Assembly / 2 Drawing). Each item carries the released
  // documentId/versionId/elementId/revision.
  async getRevisions(
    onshapeCompanyId: string,
    partNumber: string,
    elementType: number
  ): Promise<{ items: OnshapeRevision[] } & Record<string, unknown>> {
    return this.request<{ items: OnshapeRevision[] } & Record<string, unknown>>(
      "GET",
      `/api/v10/revisions/companies/${onshapeCompanyId}/partnumber/${encodeURIComponent(
        partNumber
      )}?elementType=${elementType}`
    );
  }

  // All released revisions for a company, paginated. No elementType filter
  // needed — returns every type (0/1/2). Optional `after` (ISO
  // date) returns only revisions released after it, enabling cheap incremental sync.
  // Far fewer calls than per-part-number lookups for a backfill/reconcile.
  async getCompanyRevisions(
    onshapeCompanyId: string,
    options: { limit?: number; offset?: number; after?: string } = {}
  ): Promise<
    { items: OnshapeRevision[]; next?: string | null } & Record<string, unknown>
  > {
    const params = new URLSearchParams({ limit: String(options.limit ?? 50) });
    if (options.offset != null) {
      params.set("offset", String(options.offset));
    }
    if (options.after) {
      params.set("after", options.after);
    }
    return this.request<
      { items: OnshapeRevision[]; next?: string | null } & Record<
        string,
        unknown
      >
    >(
      "GET",
      `/api/v10/revisions/companies/${onshapeCompanyId}?${params.toString()}`
    );
  }

  // Follow Onshape's own pagination cursor (the `next` URL from
  // getCompanyRevisions). Onshape caps `offset` at 100 and its `next` advances by
  // `after=<date>&offset=1`, so following the cursor — NOT incrementing offset — is
  // the only way to page a company's full revision history. `next` is an absolute
  // cad.onshape.com URL; axios uses it as-is (same host, so the auth header applies).
  async getCompanyRevisionsPage(
    nextUrl: string
  ): Promise<
    { items: OnshapeRevision[]; next?: string | null } & Record<string, unknown>
  > {
    return this.request<
      { items: OnshapeRevision[]; next?: string | null } & Record<
        string,
        unknown
      >
    >("GET", nextUrl);
  }

  // --- Release-asset export ---------------------------------------------------
  // Onshape's api/v10 translation API. Version-scoped (/v/) to match
  // getBillOfMaterials — released assets live at a version. The async flow:
  // create translation -> poll getTranslation until requestState DONE ->
  // download the result.
  //
  // Behavior confirmed against live translations of a Part Studio and a
  // released Assembly at a version (a revision's canExport:false is a UI flag,
  // not an API gate — export succeeds):
  //   - POST returns { id, requestState: "ACTIVE" };
  //   - getTranslation polls requestState ACTIVE -> DONE;
  //   - with storeInDocument=false the DONE result is at resultExternalDataIds[],
  //     downloaded from resultDocumentId via downloadExternalData(). Completions
  //     are typically seconds, so poll-with-backoff is sufficient (no
  //     translation.complete webhook needed).
  // Untested paths (low risk):
  //   - single-part export via `partIds` (whole-Part-Studio export is confirmed);
  //   - drawing (PDF) translation — same pattern, but not yet exercised against
  //     a live DRAWING element.

  // Parts inside a Part Studio: bridges geometry addressing (part `id` = partId)
  // and business identity (`partNumber`, the Onshape<->Carbon join key).
  async getParts(
    documentId: string,
    versionId: string,
    elementId: string
  ): Promise<OnshapePart[]> {
    return this.request<OnshapePart[]>(
      "GET",
      `/api/v10/parts/d/${documentId}/v/${versionId}/e/${elementId}`
    );
  }

  async createPartStudioTranslation(
    documentId: string,
    versionId: string,
    elementId: string,
    options: {
      formatName?: OnshapeModelTranslationFormat;
      storeInDocument?: boolean;
      configuration?: string;
      resolution?: OnshapeMeshResolution;
      // FLAGGED: single-part export support unverified. Omit to export the whole
      // Part Studio; the reliable documented path is a whole-Part-Studio translation.
      partIds?: string;
    } = {}
  ): Promise<OnshapeTranslation> {
    return this.request<OnshapeTranslation>(
      "POST",
      `/api/v10/partstudios/d/${documentId}/v/${versionId}/e/${elementId}/translations`,
      {
        formatName: options.formatName ?? "GLTF",
        storeInDocument: options.storeInDocument ?? false,
        // Mesh exports (GLTF) REQUIRE tessellation detail — without it Onshape
        // fails the translation with "Invalid GLTF detail parameters were
        // specified" (verified live). "medium" mirrors the Onshape UI default.
        resolution: options.resolution ?? "medium",
        ...(options.configuration
          ? { configuration: options.configuration }
          : {}),
        ...(options.partIds ? { partIds: options.partIds } : {})
      }
    );
  }

  async createAssemblyTranslation(
    documentId: string,
    versionId: string,
    elementId: string,
    options: {
      formatName?: OnshapeModelTranslationFormat;
      storeInDocument?: boolean;
      configuration?: string;
      resolution?: OnshapeMeshResolution;
    } = {}
  ): Promise<OnshapeTranslation> {
    return this.request<OnshapeTranslation>(
      "POST",
      `/api/v10/assemblies/d/${documentId}/v/${versionId}/e/${elementId}/translations`,
      {
        formatName: options.formatName ?? "GLTF",
        storeInDocument: options.storeInDocument ?? false,
        // Same requirement as the Part Studio path — see comment there.
        resolution: options.resolution ?? "medium",
        ...(options.configuration
          ? { configuration: options.configuration }
          : {})
      }
    );
  }

  async createDrawingTranslation(
    documentId: string,
    versionId: string,
    elementId: string,
    options: {
      formatName?: OnshapeDrawingTranslationFormat;
      storeInDocument?: boolean;
    } = {}
  ): Promise<OnshapeTranslation> {
    return this.request<OnshapeTranslation>(
      "POST",
      `/api/v10/drawings/d/${documentId}/v/${versionId}/e/${elementId}/translations`,
      {
        formatName: options.formatName ?? "PDF",
        storeInDocument: options.storeInDocument ?? false
      }
    );
  }

  async getTranslation(translationId: string): Promise<OnshapeTranslation> {
    return this.request<OnshapeTranslation>(
      "GET",
      `/api/v10/translations/${translationId}`
    );
  }

  // Binary download for storeInDocument=false results (GLTF/PDF bytes). Uses the
  // axios instance directly with arraybuffer — the shared `request` helper is
  // JSON-oriented and would corrupt binary. `maxBytes` bounds the download via
  // axios maxContentLength: when Onshape sends Content-Length the request
  // aborts before the body transfers; otherwise it aborts as soon as the cap
  // is crossed — either way a multi-GB assembly export never gets buffered.
  async downloadExternalData(
    documentId: string,
    foreignId: string,
    options: { maxBytes?: number } = {}
  ): Promise<ArrayBuffer> {
    try {
      const response = await this.axiosInstance.request<ArrayBuffer>({
        method: "GET",
        url: `/api/v10/documents/d/${documentId}/externaldata/${foreignId}`,
        responseType: "arraybuffer",
        ...(options.maxBytes ? { maxContentLength: options.maxBytes } : {})
      });
      return response.data;
    } catch (error) {
      if (
        options.maxBytes &&
        error instanceof Error &&
        /maxContentLength/i.test(error.message)
      ) {
        throw new OnshapeAssetTooLargeError(
          `Onshape external data ${foreignId} exceeds the ${Math.round(
            options.maxBytes / (1024 * 1024)
          )}MB limit`
        );
      }
      throw this.toApiError(error);
    }
  }

  // Onshape-rendered element thumbnail at a version (shaded view PNG). Lets the
  // sync set an item thumbnail with one small API call instead of screenshotting
  // the viewer against the full decoded mesh (the model-thumbnail pipeline).
  // `size` is a WxH string from Onshape's fixed set (e.g. "300x300").
  async getElementThumbnail(
    documentId: string,
    versionId: string,
    elementId: string,
    size: string = "300x300"
  ): Promise<ArrayBuffer> {
    try {
      const response = await this.axiosInstance.request<ArrayBuffer>({
        method: "GET",
        url: `/api/v10/thumbnails/d/${documentId}/v/${versionId}/e/${elementId}/s/${size}`,
        responseType: "arraybuffer",
        headers: { Accept: "image/png" }
      });
      return response.data;
    } catch (error) {
      throw this.toApiError(error);
    }
  }

  // Stream external data to a file on disk — for results too large to buffer
  // in memory (e.g. a multi-GB GLTF export destined for compression, not
  // attachment). Aborts with OnshapeAssetTooLargeError as soon as the
  // Content-Length header (or the byte count, when the header is absent)
  // crosses `maxBytes`. Returns the number of bytes written.
  async downloadExternalDataToFile(
    documentId: string,
    foreignId: string,
    destinationPath: string,
    options: { maxBytes: number }
  ): Promise<number> {
    const { createWriteStream } = await import("node:fs");
    const { pipeline } = await import("node:stream/promises");
    const { Transform } = await import("node:stream");

    let response: {
      headers: Record<string, unknown>;
      data: NodeJS.ReadableStream;
    };
    try {
      response = await this.axiosInstance.request({
        method: "GET",
        url: `/api/v10/documents/d/${documentId}/externaldata/${foreignId}`,
        responseType: "stream"
      });
    } catch (error) {
      throw this.toApiError(error);
    }

    const tooLarge = () =>
      new OnshapeAssetTooLargeError(
        `Onshape external data ${foreignId} exceeds the ${Math.round(
          options.maxBytes / (1024 * 1024)
        )}MB limit`
      );

    const contentLength = Number(response.headers["content-length"]);
    if (Number.isFinite(contentLength) && contentLength > options.maxBytes) {
      (response.data as unknown as { destroy: () => void }).destroy();
      throw tooLarge();
    }

    let bytesWritten = 0;
    const byteCounter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytesWritten += chunk.byteLength;
        if (bytesWritten > options.maxBytes) {
          callback(tooLarge());
          return;
        }
        callback(null, chunk);
      }
    });

    await pipeline(
      response.data,
      byteCounter,
      createWriteStream(destinationPath)
    );
    return bytesWritten;
  }

  static async refreshAccessToken(refreshToken: string): Promise<{
    access_token: string;
    refresh_token: string;
    token_type: string;
  }> {
    if (!ONSHAPE_CLIENT_ID || !ONSHAPE_CLIENT_SECRET) {
      throw new Error("Onshape OAuth not configured");
    }

    const response = await fetch("https://oauth.onshape.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: ONSHAPE_CLIENT_ID,
        client_secret: ONSHAPE_CLIENT_SECRET
      })
    });

    if (!response.ok) {
      throw new Error(
        `Onshape token refresh failed (${response.status}): ${await response.text()}`
      );
    }

    return response.json();
  }
}

export async function getOnshapeClient(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string
): Promise<
  { client: OnshapeClient; error: null } | { client: null; error: string }
> {
  const integration = await client
    .from("companyIntegration")
    .select("*")
    .eq("id", "onshape")
    .eq("companyId", companyId)
    .maybeSingle();

  if (integration.error || !integration.data) {
    return { client: null, error: "Onshape integration not found" };
  }

  const metadata = integration.data.metadata as Record<string, any>;
  const credentials = metadata?.credentials;

  if (!credentials?.accessToken) {
    return { client: null, error: "Onshape credentials not found" };
  }

  let accessToken = credentials.accessToken;
  const baseUrl = metadata?.baseUrl ?? "https://cad.onshape.com";

  // Refresh token if expired
  if (
    credentials.expiresAt &&
    credentials.refreshToken &&
    new Date(credentials.expiresAt) <= new Date()
  ) {
    try {
      const refreshed = await OnshapeClient.refreshAccessToken(
        credentials.refreshToken
      );

      accessToken = refreshed.access_token;

      // Persist the new tokens
      await client
        .from("companyIntegration")
        .update({
          metadata: {
            ...metadata,
            credentials: {
              ...credentials,
              accessToken: refreshed.access_token,
              refreshToken: refreshed.refresh_token,
              expiresAt: new Date(Date.now() + 3600 * 1000).toISOString()
            }
          },
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .eq("id", "onshape")
        .eq("companyId", companyId);
    } catch (error) {
      logger.error("Failed to refresh Onshape token", { error });
      return { client: null, error: "Failed to refresh Onshape token" };
    }
  }

  return {
    client: new OnshapeClient({ baseUrl, accessToken }),
    error: null
  };
}
