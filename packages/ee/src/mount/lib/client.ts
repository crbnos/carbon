// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Copyright (C) Carbon Manufacturing Systems Corporation.
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import axios, { type AxiosInstance } from "axios";
import { resolveIntegrationSecrets } from "../../integrations/secrets";
import {
  isHttpsUrl,
  MOUNT_API_VERSION,
  MOUNT_DEFAULT_BASE_URL
} from "./constants";
import { getMountIntegration, MOUNT_INTEGRATION_ID } from "./service";
import {
  type MountChange,
  type MountCompany,
  type MountCompanyInput,
  MountCompanySchema,
  type MountCompanyType,
  MountCompanyTypeSchema,
  MountDomainSchema,
  MountNotFoundError,
  type MountObject,
  type MountObjectDefinition,
  MountObjectDefinitionSchema,
  type MountObjectInput,
  MountObjectSchema
} from "./types";

const logger = getLogger("ee", "mount");

type MountSettings = {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
  tenant: string;
  scope?: string;
};

type CachedToken = {
  accessToken: string;
  expiresAt: number;
  connection: string;
};

const TOKEN_EXPIRY_MARGIN_MS = 60_000;

export class MountClient {
  instance: AxiosInstance;
  private tokens = new Map<string, CachedToken>();
  /** One pending exchange per company, shared by concurrent callers. */
  private inflight = new Map<
    string,
    { connection: string; exchange: Promise<string> }
  >();
  /** Domain setting (identifier or title) -> id, per company. */
  private domainIds = new Map<string, string>();

  constructor() {
    this.instance = axios.create({
      headers: { "Content-Type": "application/json" },
      // Concurrent callers share one token exchange; a hung endpoint must
      // reject eventually or all of them wait on it.
      timeout: MOUNT_REQUEST_TIMEOUT_MS,
      // Every request carries the client secret or a bearer token, and a
      // 307/308 would resend them to wherever it points, another host or
      // plain HTTP. Mount's API has no reason to redirect, so none are
      // followed: a 3xx fails like any other error.
      maxRedirects: 0
    });
  }

  private async getAccessToken(
    companyId: string,
    settings: MountSettings,
    { force = false }: { force?: boolean } = {}
  ): Promise<string> {
    const connection = connectionKey(settings);
    const cached = this.tokens.get(companyId);
    if (
      !force &&
      cached &&
      cached.connection === connection &&
      cached.expiresAt - TOKEN_EXPIRY_MARGIN_MS > Date.now()
    ) {
      return cached.accessToken;
    }

    // A publish run resolves its settings with several requests at once;
    // without this each of them would exchange its own token.
    const pending = this.inflight.get(companyId);
    if (!force && pending?.connection === connection) {
      return await pending.exchange;
    }

    const exchange = this.exchangeToken(companyId, settings, connection);
    this.inflight.set(companyId, { connection, exchange });
    try {
      return await exchange;
    } finally {
      if (this.inflight.get(companyId)?.exchange === exchange) {
        this.inflight.delete(companyId);
      }
    }
  }

  private async exchangeToken(
    companyId: string,
    settings: MountSettings,
    connection: string
  ): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: settings.clientId,
      client_secret: settings.clientSecret
    });

    const response = await this.instance.request<{
      accessToken: string;
      expiresAt: string;
    }>({
      method: "POST",
      baseURL: settings.baseUrl || MOUNT_DEFAULT_BASE_URL,
      url: "/auth/v2/token",
      data: body.toString(),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Tenant": settings.tenant
      }
    });

    const { accessToken, expiresAt } = response.data;
    if (!accessToken) {
      throw new Error("Mount token endpoint returned no access token");
    }

    this.tokens.set(companyId, {
      accessToken,
      expiresAt: Date.parse(expiresAt),
      connection
    });

    return accessToken;
  }

  invalidateToken(companyId: string) {
    this.tokens.delete(companyId);
  }

  async getSettings(companyId: string): Promise<MountSettings> {
    const serviceRole = getCarbonServiceRole();
    const { data } = await getMountIntegration(serviceRole, companyId);
    const integration = data?.[0];

    if (!integration) {
      throw new Error("Mount integration not found for company");
    }

    const metadata = (await resolveIntegrationSecrets(
      serviceRole,
      companyId,
      MOUNT_INTEGRATION_ID,
      integration.metadata,
      integration.secretRef
    )) as MountSettings;

    if (!metadata?.clientSecret) {
      throw new Error("Mount integration is missing a client secret");
    }

    if (!metadata?.clientId) {
      throw new Error("Mount integration is missing a client ID");
    }

    // Also enforced by the settings schema; checked here for values saved
    // before that, since the secret is sent to this URL.
    if (!isHttpsUrl(metadata.baseUrl || MOUNT_DEFAULT_BASE_URL)) {
      throw new Error("Mount API URL must use HTTPS");
    }

    return metadata;
  }

  /**
   * `X-Domain-Id` only filters when it carries the domain's id; any other
   * value is silently ignored and the request runs tenant-wide. Users know a
   * domain by its identifier (the `qa` in its URL) or its title, so the
   * setting takes either and is resolved here. An unmatched value fails every
   * request, which surfaces as an unhealthy integration instead of an
   * unfiltered one.
   */
  private async resolveDomainId(
    companyId: string,
    settings: MountSettings
  ): Promise<string | null> {
    const scope = settings.scope?.trim();
    if (!scope) return null;
    if (UUID_PATTERN.test(scope)) return scope;

    const key = `${companyId}:${connectionKey(settings)}:${scope}`;
    const cached = this.domainIds.get(key);
    if (cached) return cached;

    const domains = await this.request<unknown[]>(
      companyId,
      { method: "GET", path: "/Domains" },
      { withDomain: false }
    );
    const wanted = scope.toLowerCase();
    const match = MountDomainSchema.array()
      .parse(domains)
      .find(
        (domain) =>
          domain.identifier?.toLowerCase() === wanted ||
          domain.title.toLowerCase() === wanted
      );

    if (!match) {
      throw new Error(
        `Mount domain "${scope}" not found. Use its identifier or title, as listed in Mount.`
      );
    }

    this.domainIds.set(key, match.id);
    return match.id;
  }

  private async request<T>(
    companyId: string,
    config: {
      method: "GET" | "POST" | "PATCH" | "DELETE";
      path: string;
      params?: Record<string, string | number>;
      data?: unknown;
    },
    {
      retryOnUnauthorized = true,
      withDomain = true
    }: { retryOnUnauthorized?: boolean; withDomain?: boolean } = {}
  ): Promise<T> {
    const settings = await this.getSettings(companyId);
    const accessToken = await this.getAccessToken(companyId, settings);
    const domainId = withDomain
      ? await this.resolveDomainId(companyId, settings)
      : null;

    try {
      const response = await this.instance.request<T>({
        method: config.method,
        baseURL: settings.baseUrl || MOUNT_DEFAULT_BASE_URL,
        url: config.path,
        params: config.params,
        data: config.data,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          // Optional, and defaults to `latest` when omitted — which is exactly
          // how a breaking change arrives unannounced. Always pinned.
          "Api-Version": MOUNT_API_VERSION,
          "X-Tenant": settings.tenant,
          ...(domainId ? { "X-Domain-Id": domainId } : {})
        }
      });

      return response.data;
    } catch (error) {
      // A token revoked or invalidated mid-life reads as 401. Re-exchange once
      // and replay; a second 401 is a real credential problem, not staleness.
      if (
        retryOnUnauthorized &&
        axios.isAxiosError(error) &&
        error.response?.status === 401
      ) {
        this.invalidateToken(companyId);
        return await this.request<T>(companyId, config, {
          retryOnUnauthorized: false,
          withDomain
        });
      }
      throw error;
    }
  }

  async healthcheck(companyId: string) {
    try {
      await this.request(companyId, {
        method: "GET",
        path: "/Companies",
        params: { $top: 1 }
      });
      return true;
    } catch (error) {
      logger.error("Mount healthcheck failed", { companyId, error });
      return false;
    }
  }

  async listObjectDefinitions(
    companyId: string
  ): Promise<MountObjectDefinition[]> {
    const data = await this.request<unknown[]>(companyId, {
      method: "GET",
      path: "/ObjectDefinitions"
    });
    return MountObjectDefinitionSchema.array().parse(data);
  }

  async findObjectDefinitionBySlug(
    companyId: string,
    slug: string
  ): Promise<MountObjectDefinition | null> {
    const data = await this.request<unknown[]>(companyId, {
      method: "GET",
      path: "/ObjectDefinitions",
      params: { $filter: `slug eq '${escapeODataString(slug)}'` }
    });
    const [match] = MountObjectDefinitionSchema.array().parse(data);
    return match ?? null;
  }

  async findCompanyTypeByTitle(
    companyId: string,
    title: string
  ): Promise<MountCompanyType | null> {
    const data = await this.request<unknown[]>(companyId, {
      method: "GET",
      path: "/CompanyTypes",
      params: { $filter: `title eq '${escapeODataString(title)}'` }
    });
    const [match] = MountCompanyTypeSchema.array().parse(data);
    return match ?? null;
  }

  async listCompanyTypes(companyId: string): Promise<MountCompanyType[]> {
    const data = await this.request<unknown[]>(companyId, {
      method: "GET",
      path: "/CompanyTypes"
    });
    return MountCompanyTypeSchema.array().parse(data);
  }

  async findCompaniesByIdentifier(
    companyId: string,
    identifier: string
  ): Promise<MountCompany[]> {
    const data = await this.request<unknown[]>(companyId, {
      method: "GET",
      path: "/Companies",
      params: { $filter: `identifier eq '${escapeODataString(identifier)}'` }
    });
    return MountCompanySchema.array().parse(data);
  }

  async createCompany(
    companyId: string,
    input: MountCompanyInput
  ): Promise<MountCompany> {
    const data = await this.request<unknown>(companyId, {
      method: "POST",
      path: "/Companies",
      data: input
    });
    return MountCompanySchema.parse(data);
  }

  async updateCompany(
    companyId: string,
    mountId: string,
    input: Partial<MountCompanyInput>
  ): Promise<MountChange[]> {
    return await this.patch(companyId, "Companies", mountId, input);
  }

  async findObjectsByIdentifier(
    companyId: string,
    definitionId: string,
    identifier: string
  ): Promise<MountObject[]> {
    const data = await this.request<unknown[]>(companyId, {
      method: "GET",
      path: "/Objects",
      params: {
        $filter: `definitionId eq ${definitionId} and identifier eq '${escapeODataString(
          identifier
        )}'`
      }
    });
    return MountObjectSchema.array().parse(data);
  }

  async createObject(
    companyId: string,
    input: MountObjectInput
  ): Promise<MountObject> {
    const data = await this.request<unknown>(companyId, {
      method: "POST",
      path: "/Objects",
      data: input
    });
    return MountObjectSchema.parse(data);
  }

  async updateObject(
    companyId: string,
    mountId: string,
    input: Partial<MountObjectInput>
  ): Promise<MountChange[]> {
    return await this.patch(companyId, "Objects", mountId, input);
  }

  /**
   * PATCH answers with the list of changed fields, not the record, so there
   * is nothing to parse into a Company or Object. A 404 means the record was
   * deleted in Mount, which the caller handles by publishing it again.
   */
  private async patch(
    companyId: string,
    collection: "Companies" | "Objects",
    mountId: string,
    input: unknown
  ): Promise<MountChange[]> {
    try {
      return await this.request<MountChange[]>(companyId, {
        method: "PATCH",
        path: `/${collection}/${mountId}`,
        data: input
      });
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        throw new MountNotFoundError(collection, mountId);
      }
      throw error;
    }
  }
}

function connectionKey(settings: MountSettings) {
  return [
    settings.baseUrl || MOUNT_DEFAULT_BASE_URL,
    settings.tenant,
    settings.clientId,
    settings.clientSecret
  ].join("\u0000");
}

const MOUNT_REQUEST_TIMEOUT_MS = 30_000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function escapeODataString(value: string) {
  return value.replace(/'/g, "''");
}

let mountClient: MountClient | null = null;

export function getMountClient() {
  if (!mountClient) {
    mountClient = new MountClient();
  }
  return mountClient;
}
