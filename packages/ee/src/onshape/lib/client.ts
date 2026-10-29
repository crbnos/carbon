// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// From @carbon/env directly (not the @carbon/auth root barrel, which pulls in
// React UI code with top-level await and breaks non-bundler tooling — scripts,
// test runners — that imports this client).

import type { Database } from "@carbon/database";
import { acquireLease, redis, withLease } from "@carbon/kv";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import axios from "axios";
import {
  IntegrationSecretUnavailableError,
  resolveIntegrationSecrets
} from "../../integrations/secrets";
import { normalizeConfiguration } from "../panel/status";
import { apiCallPathKey } from "./api-call-key";
import {
  getOnshapeIntegration,
  isOnshapeIntegrationId,
  ONSHAPE_DEFAULT_BASE_URL
} from "./connection";
import type { OnshapeDocument } from "./document.type";
import type { OnshapeElementType } from "./element.type";
import type { OnshapeOAuthIntegrationId } from "./integration-id";
import { getOnshapeOAuthConfig, refreshOnshapeAccessToken } from "./oauth";
import { patchOnshapeRefreshedTokens } from "./state";
import {
  isFresh,
  resolveOnshapeRefresh,
  type StoredOnshapeCredentials
} from "./token-refresh";

const logger = getLogger("ee", "onshape");

interface OnshapeClientConfig {
  baseUrl: string;
  accessToken: string;
  /**
   * Called after a 401 for a new token, or null. A stored expiry cannot see a
   * revocation, clock skew or a token that dies mid-call.
   */
  onUnauthorized?: () => Promise<string | null>;
}

/**
 * `microversionId` changes with the part's definition: the cheap "changed since
 * the last push" check.
 */
export interface OnshapeElementPart {
  partId: string;
  name: string;
  partNumber: string | null;
  revision: string | null;
  description?: string | null;
  state?: string;
  microversionId?: string;
  isHidden?: boolean;
  [key: string]: unknown;
}

export interface OnshapePart {
  id: string;
  name: string;
  partNumber: string;
  revision: string;
  description: string;
  metadata: Record<string, string>;
}

const DEV_CACHE_TTL_SECONDS = 10 * 60;
const DOCUMENT_REVISION_MAX_PAGES = 20;

export interface OnshapeElementRow {
  id: string;
  name: string;
  elementType: string; // "PARTSTUDIO" | "ASSEMBLY" | "DRAWING" | ...
  [key: string]: unknown;
}

// Stable content reads only: caching a polled endpoint (/translations) would
// break the poll loop.
const DEV_CACHEABLE_PATHS = [
  /^\/api\/v\d+\/parts\//,
  /^\/api\/v\d+\/partstudios\/.*\/massproperties/,
  // Not currentmicroversion: the element sync compares it to skip unchanged
  // exports, and a cached value would skip a changed one.
  /^\/api\/v\d+\/documents\/(?!.*\/currentmicroversion)/,
  /^\/api\/v\d+\/assemblies\/.*\/bom/,
  /^\/api\/v\d+\/metadata\//,
  // A new release shows after the TTL; flush onshape-dev-cache:* for sooner.
  /^\/api\/v\d+\/revisions\/d\//
];

export interface OnshapeMassProperties {
  bodies: Record<
    string,
    {
      mass: number[];
      volume: number[];
      centroid: number[];
      hasMass: boolean;
      [key: string]: unknown;
    }
  >;
  [key: string]: unknown;
}

export interface OnshapeCompany {
  id: string;
  name?: string;
  [key: string]: unknown;
}

// The only export formats Carbon ingests: STEP for models and PDF for
// drawings. A STEP model is what a manual upload is: the assembler builds the
// viewer GLB from it, and assembly instructions can convert and plan it. A
// mesh export (GLTF) could do neither, and left no STEP to download.
export type OnshapeModelTranslationFormat = "STEP";
export type OnshapeDrawingTranslationFormat = "PDF";

// Async translation job (STEP / PDF export). requestState transitions
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
  id?: string;
  partNumber: string;
  revision: string;
  elementType: number;
  documentId: string;
  versionId: string;
  elementId: string;
  partId?: string | null;
  configuration?: string | null;
  mimeType?: string;
  name?: string;
  releaseId?: string;
  releaseName?: string;
  releaseCreatedDate?: string;
  isObsolete?: boolean;
  [key: string]: unknown;
}

/** `parentId`: the item it sits under; a drawing's children are its models. */
export interface OnshapeReleasePackageItem {
  id: string;
  parentId: string | null;
  elementType: number;
  elementId: string | null;
  partNumber: string | null;
  revision: string | null;
}

/** Empty for the default configuration, so its URL and cache key stay put. */
function configurationQuery(configuration?: string | null): string {
  const normalized = normalizeConfiguration(configuration);
  return normalized ? `&configuration=${encodeURIComponent(normalized)}` : "";
}

// Typed API error so callers can detect rate limiting (status 429) and honor
// Retry-After instead of hammering the quota.
export class OnshapeApiError extends Error {
  status?: number;
  retryAfterSeconds?: number;
  /** The `message` of Onshape's error body, when it sent one. */
  onshapeMessage?: string;
  /** The Onshape origin the failed call went to. */
  apiOrigin?: string;

  constructor(
    message: string,
    status?: number,
    retryAfterSeconds?: number,
    onshapeMessage?: string,
    apiOrigin?: string
  ) {
    super(message);
    this.name = "OnshapeApiError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
    this.onshapeMessage = onshapeMessage;
    this.apiOrigin = apiOrigin;
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
  private onUnauthorized?: () => Promise<string | null>;
  /** One recovery per client: a second 401 is a real authorization failure. */
  private retriedUnauthorized = false;

  constructor(config: OnshapeClientConfig) {
    this.baseUrl = config.baseUrl;
    this.accessToken = config.accessToken;
    this.onUnauthorized = config.onUnauthorized;

    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      headers: this.getAuthHeaders(),
      // Bound every request so a slow/unresponsive Onshape can't hang callers
      // indefinitely (e.g. webhook reconcile during the settings-save request).
      timeout: 60_000
    });
  }

  /** The Onshape origin this client calls, e.g. `https://cad.onshape.com`. */
  get apiOrigin(): string {
    return this.baseUrl;
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
    // Dev-only cache to spare the annual API quota.
    const cacheable =
      method === "GET" && DEV_CACHEABLE_PATHS.some((re) => re.test(path));
    const cacheKey =
      process.env.ONSHAPE_DEV_CACHE === "1" && cacheable
        ? `onshape-dev-cache:${path}`
        : null;

    if (cacheKey) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) return JSON.parse(cached) as T;
      } catch {
        // Cache is best-effort.
      }
    }

    try {
      const response = await this.axiosInstance.request<T>({
        method,
        url: path,
        data: body
      });
      void this.countLiveCall(path);
      if (cacheKey) {
        try {
          await redis.set(
            cacheKey,
            JSON.stringify(response.data),
            "EX",
            DEV_CACHE_TTL_SECONDS
          );
        } catch {
          // best-effort
        }
      }
      return response.data;
    } catch (error) {
      void this.countLiveCall(path);

      if (
        axios.isAxiosError(error) &&
        error.response?.status === 401 &&
        this.onUnauthorized &&
        !this.retriedUnauthorized
      ) {
        this.retriedUnauthorized = true;
        const token = await this.onUnauthorized();
        if (token) {
          this.accessToken = token;
          this.axiosInstance.defaults.headers = {
            ...this.axiosInstance.defaults.headers,
            ...this.getAuthHeaders()
          } as typeof this.axiosInstance.defaults.headers;
          return this.request<T>(method, path, body);
        }
      }

      throw this.toApiError(error);
    }
  }

  /**
   * Where a translation result downloads from and the bearer to send, for a
   * caller that downloads it elsewhere (the assembler's `fetch`, so a large
   * export never passes through this process). The token is the one this
   * client holds: build the client right before handing it on. Counted as a
   * live call, since the download is one.
   */
  externalDataDownload(
    documentId: string,
    foreignId: string
  ): { url: string; authorization: string } {
    const path = `/api/v10/documents/d/${documentId}/externaldata/${foreignId}`;
    void this.countLiveCall(path);
    return {
      url: `${this.baseUrl.replace(/\/+$/, "")}${path}`,
      authorization: `Bearer ${this.accessToken}`
    };
  }

  /** Counts in Redis `onshape:api-calls:<year>`, and per endpoint in the hash
   *  `onshape:api-calls:<year>:paths`; never awaited. */
  private async countLiveCall(path: string) {
    try {
      const year = new Date().getUTCFullYear();
      await redis
        .multi()
        .incr(`onshape:api-calls:${year}`)
        .hincrby(`onshape:api-calls:${year}:paths`, apiCallPathKey(path), 1)
        .exec();
    } catch {
      // Never let accounting break a real request.
    }
  }

  private toApiError(error: unknown): Error {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      // No response => network error / timeout / DNS / ECONNREFUSED. Keep axios's
      // own message (e.g. "timeout of 60000ms exceeded") instead of the useless
      // "Onshape API error (undefined): undefined".
      if (status === undefined) {
        return new OnshapeApiError(
          `Onshape request failed: ${error.message}`,
          undefined,
          undefined,
          undefined,
          this.baseUrl
        );
      }
      const parsedRetryAfter = Number(error.response?.headers?.["retry-after"]);
      const data = error.response?.data as unknown;
      const onshapeMessage =
        data && typeof data === "object"
          ? (data as { message?: unknown }).message
          : undefined;
      return new OnshapeApiError(
        `Onshape API error (${status}): ${
          typeof data === "string" ? data : JSON.stringify(data)
        }`,
        status,
        Number.isFinite(parsedRetryAfter) ? parsedRetryAfter : undefined,
        typeof onshapeMessage === "string" ? onshapeMessage : undefined,
        this.baseUrl
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

  // Register a webhook subscription so Onshape POSTs events to Carbon: the
  // release webhook (onshape.revision.created, company scope) and the element
  // sync's translation webhook (onshape.model.translation.complete, document
  // scope). Requires a publicly reachable callback URL and an OAuth app that
  // permits webhook management. The API also REQUIRES `options` and a scope
  // (`companyId` or `documentId`) — omitting either is a 400 ("options field is
  // required" / "company id or document id required"). A transient webhook is
  // cleaned up by Onshape after a period of inactivity.
  async createWebhook(
    params: {
      url: string;
      events: string[];
      collapseEvents?: boolean;
      isTransient?: boolean;
    } & ({ companyId: string } | { documentId: string })
  ): Promise<{ id: string } & Record<string, unknown>> {
    return this.request<{ id: string } & Record<string, unknown>>(
      "POST",
      "/api/v10/webhooks",
      {
        url: params.url,
        events: params.events,
        ...("companyId" in params
          ? { companyId: params.companyId }
          : { documentId: params.documentId }),
        ...(params.isTransient === undefined
          ? {}
          : { isTransient: params.isTransient }),
        options: { collapseEvents: params.collapseEvents ?? false }
      }
    );
  }

  /** The workspace's current microversion: it changes on every edit to the
   *  document, so it names the workspace's exact state. */
  async getCurrentMicroversion(
    documentId: string,
    workspaceId: string
  ): Promise<string> {
    const response = await this.request<{ microversion?: string }>(
      "GET",
      `/api/v10/documents/d/${documentId}/w/${workspaceId}/currentmicroversion`
    );
    if (!response.microversion) {
      throw new Error("Onshape returned no current microversion");
    }
    return response.microversion;
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
      `/api/v10/assemblies/d/${documentId}/v/${versionId}/e/${elementId}/bom?indented=true&multiLevel=true&generateIfAbsent=true&onlyVisibleColumns=false&includeItemMicroversions=false&includeTopLevelAssemblyRow=true&thumbnail=false`
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
  // URL on the connection's own host (cad.onshape.com or a Government tenant);
  // axios uses it as-is (same host, so the auth header applies).
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

  // Onshape has no packages-by-document endpoint; grouping these revisions by
  // releaseId rebuilds the packages. Follows `next` up to the page limit.
  async getDocumentRevisions(
    documentId: string
  ): Promise<{ items: OnshapeRevision[]; next: string | null }> {
    type Page = { items?: OnshapeRevision[]; next?: string | null };
    const items: OnshapeRevision[] = [];
    let page = await this.request<Page>(
      "GET",
      `/api/v10/revisions/d/${documentId}`
    );
    items.push(...(page.items ?? []));
    for (
      let pages = 1;
      page.next && pages < DOCUMENT_REVISION_MAX_PAGES;
      pages++
    ) {
      page = await this.request<Page>("GET", page.next);
      items.push(...(page.items ?? []));
    }
    return { items, next: page.next ?? null };
  }

  /**
   * Flattened. Onshape nests a package's items while it is being set up and
   * lists them flat with `parentId` once released; both shapes are read.
   */
  async getReleasePackageItems(
    releaseId: string
  ): Promise<OnshapeReleasePackageItem[]> {
    type RawItem = {
      id?: string;
      parentId?: string | null;
      elementType?: number;
      elementId?: string | null;
      properties?: Array<{ name?: string; value?: unknown }>;
      children?: RawItem[];
    };
    const pkg = await this.request<{ items?: RawItem[] }>(
      "GET",
      `/api/v10/releasepackages/${releaseId}?detailed=true`
    );
    const text = (item: RawItem, name: string) => {
      const value = item.properties?.find((p) => p.name === name)?.value;
      return typeof value === "string" && value.trim() !== ""
        ? value.trim()
        : null;
    };
    const out: OnshapeReleasePackageItem[] = [];
    const walk = (items: RawItem[], parentId: string | null) => {
      for (const item of items) {
        if (!item.id) continue;
        out.push({
          id: item.id,
          parentId: item.parentId ?? parentId,
          elementType:
            typeof item.elementType === "number" ? item.elementType : -1,
          elementId: item.elementId ?? null,
          partNumber: text(item, "Part number"),
          revision: text(item, "Revision")
        });
        walk(item.children ?? [], item.id);
      }
    };
    walk(pkg.items ?? [], null);
    return out;
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

  /** SI units; triples are [value, min, max]; no material: hasMass=false. */
  async getPartStudioMassProperties(
    document: OnshapeDocument,
    elementId: string
  ): Promise<OnshapeMassProperties> {
    return this.request<OnshapeMassProperties>(
      "GET",
      `/api/v10/partstudios/d/${document.documentId}/${document.wvm}/${document.wvmId}/e/${elementId}/massproperties?massAsGroup=false&useMassPropertyOverrides=true`
    );
  }

  async getElementsIn(
    document: OnshapeDocument,
    elementType?: OnshapeElementType
  ): Promise<OnshapeElementRow[]> {
    return this.request<OnshapeElementRow[]>(
      "GET",
      `/api/v10/documents/d/${document.documentId}/${document.wvm}/${document.wvmId}/elements${elementType ? "?elementType=" + elementType : ""}`
    );
  }

  async getBillOfMaterialsIn(
    document: OnshapeDocument,
    elementId: string,
    configuration?: string | null
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "GET",
      `/api/v10/assemblies/d/${document.documentId}/${document.wvm}/${document.wvmId}/e/${elementId}/bom?indented=true&multiLevel=true&generateIfAbsent=true&onlyVisibleColumns=false&includeItemMicroversions=true&includeTopLevelAssemblyRow=true&thumbnail=false${configurationQuery(configuration)}`
    );
  }

  /** Without mates. Far cheaper than the BOM when only the parts are needed. */
  async getAssemblyDefinitionIn(
    document: OnshapeDocument,
    elementId: string,
    configuration?: string | null
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "GET",
      `/api/v10/assemblies/d/${document.documentId}/${document.wvm}/${document.wvmId}/e/${elementId}?includeMateFeatures=false&includeNonSolids=false&includeMateConnectors=false${configurationQuery(configuration)}`
    );
  }

  /** An assembly's own identity comes from here: the BOM omits it. */
  async getElementMetadata(
    document: OnshapeDocument,
    elementId: string,
    configuration?: string | null
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "GET",
      `/api/v10/metadata/d/${document.documentId}/${document.wvm}/${document.wvmId}/e/${elementId}?inferMetadataOwner=false&depth=1${configurationQuery(configuration)}`
    );
  }

  /** `depth=2` nests a Part Studio's `parts.items[].properties`: one read. */
  async getElementMetadataWithParts(
    document: OnshapeDocument,
    elementId: string,
    configuration?: string | null
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "GET",
      `/api/v10/metadata/d/${document.documentId}/${document.wvm}/${document.wvmId}/e/${elementId}?inferMetadataOwner=false&depth=2${configurationQuery(configuration)}`
    );
  }

  async getPartMetadata(
    document: OnshapeDocument,
    elementId: string,
    partId: string,
    configuration?: string | null
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "GET",
      `/api/v10/metadata/d/${document.documentId}/${document.wvm}/${document.wvmId}/e/${elementId}/p/${encodeURIComponent(partId)}?inferMetadataOwner=false${configurationQuery(configuration)}`
    );
  }

  async getPartsInElement(
    document: OnshapeDocument,
    elementId: string,
    configuration?: string | null
  ): Promise<OnshapeElementPart[]> {
    return this.request<OnshapeElementPart[]>(
      "GET",
      `/api/v10/parts/d/${document.documentId}/${document.wvm}/${document.wvmId}/e/${elementId}?includePropertyDefaults=true${configurationQuery(configuration)}`
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
      // FLAGGED: single-part export support unverified. Omit to export the whole
      // Part Studio; the reliable documented path is a whole-Part-Studio translation.
      partIds?: string;
      wvm?: "w" | "v";
    } = {}
  ): Promise<OnshapeTranslation> {
    return this.request<OnshapeTranslation>(
      "POST",
      `/api/v10/partstudios/d/${documentId}/${options.wvm ?? "v"}/${versionId}/e/${elementId}/translations`,
      {
        formatName: options.formatName ?? "STEP",
        storeInDocument: options.storeInDocument ?? false,
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
      wvm?: "w" | "v";
    } = {}
  ): Promise<OnshapeTranslation> {
    return this.request<OnshapeTranslation>(
      "POST",
      `/api/v10/assemblies/d/${documentId}/${options.wvm ?? "v"}/${versionId}/e/${elementId}/translations`,
      {
        formatName: options.formatName ?? "STEP",
        storeInDocument: options.storeInDocument ?? false,
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
      wvm?: "w" | "v";
    } = {}
  ): Promise<OnshapeTranslation> {
    return this.request<OnshapeTranslation>(
      "POST",
      `/api/v10/drawings/d/${documentId}/${options.wvm ?? "v"}/${versionId}/e/${elementId}/translations`,
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

  // Binary download for storeInDocument=false results (STEP/PDF bytes). Uses the
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

  // Stream external data to a file on disk — for results too large to buffer
  // in memory (e.g. a multi-GB STEP export destined for compression, not
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
}

const REFRESH_LEASE_MS = 5_000;
const REFRESH_LEASE_RENEW_MS = 2_000;
const REFRESH_WAIT_DEADLINE_MS = 20_000;
const REFRESH_WAIT_MS = 250;

export async function getOnshapeClient(
  /** The panel passes the service role: the row needs settings view. */
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  /** Omitted or a sync id: the company's active sync connection. */
  requestedIntegrationId?: OnshapeOAuthIntegrationId
): Promise<
  { client: OnshapeClient; error: null } | { client: null; error: string }
> {
  // Either sync connection — the public app or a Government private app.
  // Past authorization they are the same API, just on a different host.
  // The panel's connection must be active: uninstalling only sets
  // `active = false` and leaves the tokens, so without the filter an
  // uninstalled panel kept reading Onshape.
  const integration =
    requestedIntegrationId && !isOnshapeIntegrationId(requestedIntegrationId)
      ? await client
          .from("companyIntegration")
          .select("*")
          .eq("id", requestedIntegrationId)
          .eq("companyId", companyId)
          .eq("active", true)
          .maybeSingle()
      : await getOnshapeIntegration(client, companyId);

  if (integration.error || !integration.data) {
    return { client: null, error: "Onshape integration not found" };
  }
  // Secret material (accessToken/refreshToken) lives in Supabase Vault; merge it
  // back so we read `metadata.credentials` the same as before. Vault RPCs require
  // the service-role client (the passed `client` may be RLS-scoped).
  const { getCarbonServiceRole } = await import("@carbon/auth/client.server");
  const serviceRole = getCarbonServiceRole();
  const integrationId = integration.data.id as OnshapeOAuthIntegrationId;
  // No vaulted secret means never connected, not a server error.
  let metadata: Record<string, any>;
  try {
    metadata = (await resolveIntegrationSecrets(
      serviceRole,
      companyId,
      integrationId,
      integration.data.metadata,
      integration.data.secretRef
    )) as Record<string, any>;
  } catch (error) {
    if (error instanceof IntegrationSecretUnavailableError) {
      return { client: null, error: "Onshape credentials not found" };
    }
    throw error;
  }
  const credentials = metadata?.credentials;

  if (!credentials?.accessToken) {
    return { client: null, error: "Onshape credentials not found" };
  }

  let accessToken = credentials.accessToken;
  const baseUrl = metadata?.baseUrl ?? ONSHAPE_DEFAULT_BASE_URL;

  /** Onshape rotates refresh tokens: a later refresh must spend the new one. */
  const adoptCredentials = (next: Record<string, any> | undefined) => {
    if (!next?.accessToken) return;
    credentials.accessToken = next.accessToken;
    if (next.refreshToken) credentials.refreshToken = next.refreshToken;
    if (next.expiresAt) credentials.expiresAt = next.expiresAt;
    accessToken = next.accessToken;
  };

  /** The credentials as stored now, not as loaded when this request started. */
  const readStoredCredentials = async (): Promise<Record<
    string,
    any
  > | null> => {
    const row = await serviceRole
      .from("companyIntegration")
      .select("metadata, secretRef")
      .eq("id", integrationId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (row.error || !row.data) return null;
    const current = (await resolveIntegrationSecrets(
      serviceRole,
      companyId,
      integrationId,
      row.data.metadata,
      row.data.secretRef
    ).catch(() => null)) as Record<string, any> | null;
    return current?.credentials ?? null;
  };

  const refreshFromStored = async (): Promise<string | null> => {
    const next = resolveOnshapeRefresh(
      await readStoredCredentials(),
      credentials,
      accessToken,
      Date.now()
    );
    if (next.action === "exchange") return exchange(next.credentials);
    adoptCredentials(next.credentials);
    return accessToken;
  };

  const exchange = async (
    from: StoredOnshapeCredentials
  ): Promise<string | null> => {
    if (!from.refreshToken) return null;
    let next: { accessToken: string; refreshToken?: string; expiresAt: string };
    try {
      const oauth = getOnshapeOAuthConfig(integrationId, metadata);
      if (!oauth) throw new Error("Onshape OAuth not configured");
      const refreshed = await refreshOnshapeAccessToken(
        oauth,
        from.refreshToken
      );
      const lifetimeSeconds = refreshed.expires_in ?? 3600;
      next = {
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token,
        expiresAt: new Date(Date.now() + lifetimeSeconds * 1000).toISOString()
      };
    } catch (error) {
      logger.error("Failed to refresh Onshape token", {
        companyId,
        integrationId,
        error
      });
      return null;
    }
    // The old refresh token is spent: keep the new pair even if saving fails.
    adoptCredentials(next);
    try {
      await patchOnshapeRefreshedTokens(
        serviceRole,
        companyId,
        integrationId,
        next
      );
    } catch (error) {
      logger.error("Failed to save the refreshed Onshape token", {
        companyId,
        integrationId,
        error
      });
    }
    return next.accessToken;
  };

  /**
   * One refresh across concurrent callers, under a Redis lease: with rotating
   * refresh tokens the losing caller would store a dead pair over the live one.
   * Waiters adopt the holder's result. With Redis down it runs unlocked.
   */
  const refreshNow = async (): Promise<string | null> => {
    // Per integration: each holds its own refresh token.
    const leaseKey = `onshape-token-refresh:${companyId}:${integrationId}`;
    const deadline = Date.now() + REFRESH_WAIT_DEADLINE_MS;

    while (true) {
      const lease = await acquireLease(leaseKey, REFRESH_LEASE_MS);

      if (lease.status === "unavailable") {
        logger.warn("Refreshing the Onshape token without a lock", {
          companyId,
          integrationId
        });
        return refreshFromStored();
      }

      if (lease.status === "acquired") {
        return withLease(
          leaseKey,
          lease.owner,
          { leaseMs: REFRESH_LEASE_MS, renewMs: REFRESH_LEASE_RENEW_MS },
          refreshFromStored
        );
      }

      if (Date.now() >= deadline) return null;
      await new Promise((resolve) => setTimeout(resolve, REFRESH_WAIT_MS));
      const next = resolveOnshapeRefresh(
        await readStoredCredentials(),
        credentials,
        accessToken,
        Date.now()
      );
      if (next.action === "adopt") {
        adoptCredentials(next.credentials);
        return accessToken;
      }
    }
  };

  // No `expiresAt` guard: a connection without a stored expiry must refresh.
  if (credentials.refreshToken && !isFresh(credentials, Date.now())) {
    const refreshedToken = await refreshNow();
    if (!refreshedToken) {
      return { client: null, error: "Failed to refresh Onshape token" };
    }
    accessToken = refreshedToken;
  }

  return {
    client: new OnshapeClient({
      baseUrl,
      accessToken,
      onUnauthorized: refreshNow
    }),
    error: null
  };
}
