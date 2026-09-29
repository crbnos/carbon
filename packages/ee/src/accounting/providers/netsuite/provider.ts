import { getLogger } from "@carbon/logger";
import { ProviderID } from "../../core/models";
import type {
  AccountingEntityType,
  GlobalSyncConfig,
  ProviderCapabilities,
  ProviderConfig,
  ProviderCredentials
} from "../../core/types";
import { BaseProvider } from "../../core/types";
import {
  AccountingApiError,
  type ApiErrorDetails,
  HTTPClient,
  type HttpResponse
} from "../../core/utils";
import { netsuiteOrigin, netsuiteRealm, signNetSuiteRequest } from "./auth";

const logger = getLogger("ee", "accounting", "netsuite");

const SUITEQL_PAGE = 1000;

const DISABLED_ENTITIES = [
  "customer",
  "vendor",
  "item",
  "employee",
  "purchaseOrder",
  "bill",
  "salesOrder",
  "invoice",
  "payment",
  "inventoryAdjustment",
  "charge",
  "creditMemo",
  "supplierCredit",
  "reimbursement"
] as const satisfies readonly AccountingEntityType[];

type TbaCredentials = Extract<ProviderCredentials, { type: "tba" }>;

type SuiteQlPage<T> = {
  items?: T[];
  hasMore?: boolean;
};

type AccountRow = {
  id?: string;
  acctnumber?: string;
  fullname?: string;
};

export type NetSuiteJournalLine = {
  account: { id: string };
  debit?: number;
  credit?: number;
  memo?: string;
};

export type NetSuiteJournalWrite = {
  externalId: string;
  tranDate: string;
  memo?: string;
  subsidiary?: { id: string };
  currency: { id: string };
  line: { items: NetSuiteJournalLine[] };
};

export type NetSuiteJournalEntry = {
  id: string;
  line?: {
    items?: Array<{
      account?: { id?: string };
      debit?: number;
      credit?: number;
    }>;
  };
};

export function buildNetSuiteSyncConfig(
  resolved: GlobalSyncConfig
): GlobalSyncConfig {
  const entities = Object.fromEntries(
    Object.entries(resolved.entities).map(([entityType, entityConfig]) => [
      entityType,
      { ...entityConfig }
    ])
  ) as GlobalSyncConfig["entities"];

  for (const entityType of DISABLED_ENTITIES) {
    entities[entityType] = { ...entities[entityType], enabled: false };
  }

  entities.journalEntry = {
    ...entities.journalEntry,
    enabled: true,
    direction: "push-to-accounting",
    owner: "carbon"
  };

  return { entities };
}

function tbaCredentials(
  credentials: ProviderCredentials | undefined
): TbaCredentials {
  if (credentials?.type !== "tba") {
    throw new Error(
      `NetSuite requires tba credentials, received "${credentials?.type ?? "none"}"`
    );
  }
  return credentials;
}

function netsuiteErrorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") return fallback;
  const details = (data as { "o:errorDetails"?: Array<{ detail?: string }> })[
    "o:errorDetails"
  ];
  const detail = details
    ?.map((entry) => entry.detail)
    .filter((entry): entry is string => !!entry)
    .join("; ");
  if (detail) return detail;
  const title = (data as { title?: string }).title;
  return title || fallback;
}

function failNetSuite(
  operation: string,
  response: HttpResponse<unknown>
): never {
  const details: ApiErrorDetails = {
    statusCode: response.code,
    statusText: response.message,
    providerMessage: netsuiteErrorMessage(response.data, response.message),
    rawResponse: response.data
  };
  throw new AccountingApiError("netsuite", operation, details);
}

export type NetSuiteProviderConfig = Omit<
  ProviderConfig<{
    credentials?: ProviderCredentials;
  }>,
  "id"
>;

const NO_OAUTH =
  "NetSuite uses token-based authentication. There is no OAuth redirect.";

export class NetSuiteProvider extends BaseProvider {
  static id = ProviderID.NETSUITE;

  readonly capabilities: ProviderCapabilities = {
    role: "accounting",
    transport: "rest",
    supportsWebhooks: false,
    supportsJournalPush: true
  };

  private readonly origin: string;
  private readonly realm: string;
  private readonly http: HTTPClient;
  private readonly syncConfig: GlobalSyncConfig;
  private readonly currencyIds = new Map<string, string>();

  constructor(public config: NetSuiteProviderConfig) {
    super();
    this.creds = config.credentials;
    this.syncConfig = buildNetSuiteSyncConfig(config.syncConfig);
    const accountId =
      config.credentials?.type === "tba" ? config.credentials.accountId : "";
    this.origin = accountId ? netsuiteOrigin(accountId) : "";
    this.realm = accountId ? netsuiteRealm(accountId) : "";
    this.http = new HTTPClient(this.origin || undefined);
    this.auth = {
      getCredentials: () => tbaCredentials(this.creds),
      getAuthUrl: () => {
        throw new Error(NO_OAUTH);
      },
      exchangeCode: () => {
        throw new Error(NO_OAUTH);
      },
      refresh: () => {
        throw new Error(NO_OAUTH);
      }
    };
  }

  get id(): ProviderID.NETSUITE {
    return ProviderID.NETSUITE;
  }

  get subsidiaryId(): string | null {
    if (this.creds?.type !== "tba") return null;
    const value = this.creds.providerMetadata?.subsidiaryId;
    return typeof value === "string" && value.length > 0 ? value : null;
  }

  getSyncConfig(entity: AccountingEntityType) {
    return this.syncConfig.entities[entity];
  }

  async authenticate(): Promise<ProviderCredentials> {
    throw new Error(NO_OAUTH);
  }

  async validate(): Promise<boolean> {
    try {
      await this.suiteql<{ id: string }>(
        "SELECT id FROM account WHERE isinactive = 'F'",
        { limit: 1, offset: 0 }
      );
      return true;
    } catch {
      return false;
    }
  }

  async listChartOfAccounts(): Promise<
    Array<{ id: string; code: string; name: string }>
  > {
    try {
      const rows: AccountRow[] = [];
      let offset = 0;
      for (;;) {
        const page = await this.suiteql<AccountRow>(
          "SELECT id, acctnumber, fullname FROM account WHERE isinactive = 'F' AND issummary = 'F' ORDER BY id",
          { limit: SUITEQL_PAGE, offset }
        );
        rows.push(...page.items);
        if (!page.hasMore || page.items.length === 0) break;
        offset += page.items.length;
      }

      return rows.flatMap((row) => {
        if (!row.id) return [];
        const code = row.acctnumber || row.id;
        return [
          {
            id: row.id,
            code,
            name: row.fullname || code
          }
        ];
      });
    } catch (error) {
      logger.error("Failed to list NetSuite accounts", { error });
      return [];
    }
  }

  async getCurrencyId(symbol: string): Promise<string> {
    const code = symbol.trim().toUpperCase();
    const cached = this.currencyIds.get(code);
    if (cached) return cached;
    if (!/^[A-Z]{3}$/.test(code)) {
      throw new Error(`Invalid currency code "${symbol}"`);
    }

    const page = await this.suiteql<{ id: string }>(
      `SELECT id FROM currency WHERE symbol = '${code}'`,
      { limit: 1, offset: 0 }
    );
    const id = page.items[0]?.id;
    if (!id) throw new Error(`NetSuite has no currency ${code}`);
    this.currencyIds.set(code, id);
    return id;
  }

  async getJournalEntry(id: string): Promise<NetSuiteJournalEntry | null> {
    const response = await this.request<NetSuiteJournalEntry>(
      "GET",
      `/services/rest/record/v1/journalEntry/${encodeURIComponent(id)}?expandSubResources=true`
    );
    if (response.error) {
      if (response.code === 404) return null;
      failNetSuite("get journal entry", response);
    }
    if (!response.data?.id) return null;
    return response.data;
  }

  async upsertJournalEntry(payload: NetSuiteJournalWrite): Promise<string> {
    const existing = await this.getJournalEntryByExternalId(payload.externalId);
    if (existing) return existing.id;

    const response = await this.request<NetSuiteJournalEntry>(
      "POST",
      "/services/rest/record/v1/journalEntry",
      payload,
      { Prefer: "return=representation" }
    );
    if (response.error || !response.data?.id) {
      failNetSuite("create journal entry", response);
    }
    return response.data.id;
  }

  private async getJournalEntryByExternalId(
    externalId: string
  ): Promise<NetSuiteJournalEntry | null> {
    const response = await this.request<NetSuiteJournalEntry>(
      "GET",
      `/services/rest/record/v1/journalEntry/eid:${encodeURIComponent(externalId)}?expandSubResources=true`
    );
    if (response.error) {
      if (response.code === 404) return null;
      failNetSuite("lookup journal entry", response);
    }
    if (!response.data?.id) {
      failNetSuite("lookup journal entry", response);
    }
    return response.data;
  }

  private async suiteql<T>(
    q: string,
    page: { limit: number; offset: number }
  ): Promise<{ items: T[]; hasMore: boolean }> {
    const response = await this.request<SuiteQlPage<T>>(
      "POST",
      `/services/rest/query/v1/suiteql?limit=${page.limit}&offset=${page.offset}`,
      { q },
      { Prefer: "transient" }
    );
    if (response.error) failNetSuite("suiteql", response);
    return {
      items: response.data?.items ?? [],
      hasMore: response.data?.hasMore === true
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>
  ): Promise<HttpResponse<T>> {
    const creds = tbaCredentials(this.creds);
    const url = `${this.origin}${path}`;
    const signed = signNetSuiteRequest({
      method,
      url,
      realm: this.realm,
      consumerKey: creds.consumerKey,
      consumerSecret: creds.consumerSecret,
      tokenId: creds.tokenId,
      tokenSecret: creds.tokenSecret
    });

    return this.http.request<T>(method, path, {
      headers: {
        Authorization: signed.authorization,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...extraHeaders
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  }
}
