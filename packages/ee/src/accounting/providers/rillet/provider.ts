import { createHash } from "node:crypto";
import { ProviderID } from "../../core/models";
import type {
  AccountingEntityType,
  AuthProvider,
  DimensionTarget,
  GlobalSyncConfig,
  ListChangesResult,
  ProviderCapabilities,
  ProviderChange,
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
import {
  getRilletBillPaymentSyncEntityId,
  getRilletPaymentSyncEntityId
} from "./entities/payment";
import type {
  Rillet,
  RilletBillCreate,
  RilletCustomerWrite,
  RilletInvoiceCreate,
  RilletJournalEntryCreate,
  RilletPaymentCreate,
  RilletProductWrite,
  RilletVendorWrite
} from "./models";

const RILLET_PRODUCTION_HOST = "https://api.rillet.com";
const RILLET_SANDBOX_HOST = "https://sandbox.api.rillet.com";

/**
 * Pinned Rillet API version, sent as X-Rillet-API-Version on every request
 * — the server-side default flips on 2026-08-01, so pinning is what keeps
 * the wire contract stable. Bump deliberately, in one place.
 */
export const RILLET_API_VERSION = "4";

/** Rillet's page-size cap for cursor-paginated list endpoints. */
export const RILLET_PAGE_SIZE = 100;

/** Dimension slot target prefix: `field:<fieldId>` (Rillet Field uuid). */
const RILLET_FIELD_TARGET_PREFIX = "field:";

export function buildRilletFieldTarget(fieldId: string): string {
  return `${RILLET_FIELD_TARGET_PREFIX}${fieldId}`;
}

/** The Field uuid inside a `field:<id>` target; null otherwise. */
export function parseRilletFieldTarget(target: string): string | null {
  if (!target.startsWith(RILLET_FIELD_TARGET_PREFIX)) return null;
  const fieldId = target.slice(RILLET_FIELD_TARGET_PREFIX.length);
  return fieldId.length > 0 ? fieldId : null;
}

// /********************************************************\
// *              RFC 9457 problem parsing                  *
// \********************************************************/

/**
 * Parse a Rillet error response into structured ApiErrorDetails. Rillet
 * errors are RFC 9457 problem details — `{ type (uri), title, status,
 * detail }` — optionally carrying an `errors` array extension whose entry
 * shape is not pinned by the docs, so it is read defensively (strings or
 * objects with pointer/field + detail/message).
 */
export function extractRilletErrorDetails(
  statusCode: number,
  statusText: string,
  responseData: unknown
): ApiErrorDetails {
  const details: ApiErrorDetails = {
    statusCode,
    statusText,
    rawResponse: responseData
  };

  let data: unknown = responseData;
  if (typeof responseData === "string") {
    try {
      data = JSON.parse(responseData);
    } catch {
      if (responseData.length < 500) {
        details.providerMessage = responseData;
      }
      return details;
    }
  }

  if (typeof data !== "object" || data === null) {
    return details;
  }

  const problem = data as Record<string, unknown>;

  if (typeof problem.type === "string") {
    details.providerErrorType = problem.type;
  }
  if (
    typeof problem.status === "number" ||
    typeof problem.status === "string"
  ) {
    details.providerErrorCode = problem.status;
  }
  if (typeof problem.detail === "string") {
    details.providerMessage = problem.detail;
  } else if (typeof problem.title === "string") {
    details.providerMessage = problem.title;
  }

  if (Array.isArray(problem.errors)) {
    const validationErrors: Array<{ field?: string; message: string }> = [];
    for (const entry of problem.errors) {
      if (typeof entry === "string") {
        validationErrors.push({ message: entry });
        continue;
      }
      if (typeof entry !== "object" || entry === null) continue;

      const record = entry as Record<string, unknown>;
      const field = [record.pointer, record.field, record.path].find(
        (value): value is string => typeof value === "string"
      );
      const message = [record.detail, record.message, record.title].find(
        (value): value is string => typeof value === "string"
      );
      validationErrors.push({
        field,
        message: message ?? JSON.stringify(entry)
      });
    }
    if (validationErrors.length > 0) {
      details.validationErrors = validationErrors;
    }
  }

  return details;
}

/**
 * Creates, logs and throws an AccountingApiError from a failed Rillet
 * response (parallel to throwQboApiError / throwXeroApiError).
 */
export function throwRilletApiError(
  operation: string,
  response: { error: boolean; message: string; code: number; data: unknown }
): never {
  const details = extractRilletErrorDetails(
    response.code,
    response.message,
    response.data
  );

  const error = new AccountingApiError("rillet", operation, details);

  console.error(`[Rillet API Error] ${operation}`, {
    statusCode: details.statusCode,
    statusText: details.statusText,
    providerErrorType: details.providerErrorType,
    providerErrorCode: details.providerErrorCode,
    providerMessage: details.providerMessage,
    validationErrors: details.validationErrors
  });

  throw error;
}

/**
 * True when Rillet rejected a write because an external_references entry
 * uses a type slug the organization hasn't registered. Reference types are
 * dashboard-only configuration (Rillet Settings → External References) —
 * there is no API to create them — so callers degrade: optional references
 * are stripped and the write retried; required ones (AR_ONLY invoices)
 * surface a user-fixable Warning.
 */
export function isRilletUnknownExternalReferenceTypeError(
  error: unknown
): boolean {
  if (!(error instanceof AccountingApiError)) return false;
  // Rillet's RFC 9457 type URI is the stable signal; the message text is a
  // fallback for older responses that only carried the detail.
  if (
    typeof error.details.providerErrorType === "string" &&
    error.details.providerErrorType.endsWith(
      "/exception/external_reference_type_not_found"
    )
  ) {
    return true;
  }
  return (
    typeof error.details.providerMessage === "string" &&
    error.details.providerMessage.includes(
      "External reference type does not exist"
    )
  );
}

/**
 * Deterministic Idempotency-Key for a Rillet create POST (Rillet replays
 * the stored response for 24h): the same company + operation + local
 * entity always produces the same key, so a retried push cannot
 * double-create — even when the retry's payload drifted (dimension
 * resolution, an edit between attempts). The payload is deliberately NOT
 * hashed (v4 spec, Pillar C): a crash between the remote create and the
 * local mapping write retries the push, and a payload-sensitive key would
 * mint a fresh key for the drifted payload and duplicate the document
 * remotely. Every call site's localId identifies one logical create
 * (composite ids for payments, `:reversal`-suffixed ids for reversal
 * journals, batch keys for consolidated journals).
 */
export function buildRilletIdempotencyKey(args: {
  companyId: string;
  operation: string;
  localId: string;
}): string {
  return createHash("sha256")
    .update(`${args.companyId}:${args.operation}:${args.localId}`)
    .digest("hex");
}

// /********************************************************\
// *              Sync-config constraints                   *
// \********************************************************/

/**
 * Entities Rillet syncs in v1 — every one of them PUSH-ONLY (Carbon →
 * Rillet). Rillet is the ledger of record for what Carbon pushes; pulling
 * master data back is a follow-up.
 */
export const RILLET_PUSH_ONLY_ENTITIES = [
  "customer",
  "vendor",
  "item",
  "invoice",
  "bill",
  "journalEntry"
] as const satisfies readonly AccountingEntityType[];

/**
 * Entities Rillet syncs TWO-WAY: `payment`. Inbound (pull) — provider-recorded
 * invoice/bill payments settle Carbon documents (Phase F). Outbound (push) —
 * Carbon-born Posted payments (e.g. a bill paid through Ramp, recorded in
 * Carbon) are written to Rillet as payment documents (Phase G). Which direction
 * fires per record is decided by origin: a payment already carrying a `payment`
 * mapping is provider-known and skips push; a mapping-less Carbon payment is
 * pushed. Both flow through the same `payment` syncer.
 */
export const RILLET_TWO_WAY_ENTITIES = [
  "payment"
] as const satisfies readonly AccountingEntityType[];

/**
 * Entities Rillet does not sync (force-disabled): Rillet has no purchase
 * order endpoint, and inventory adjustments flow as journals through the
 * posting sync.
 */
export const RILLET_DISABLED_ENTITIES = [
  "purchaseOrder",
  "salesOrder",
  "inventoryAdjustment",
  "employee"
] as const satisfies readonly AccountingEntityType[];

/**
 * Constrain a resolved sync config to what Rillet supports (modeled on
 * buildQbdSyncConfig): supported document entities are forced to direction
 * "push-to-accounting" with owner "carbon" (push-only is a capability
 * limit, not a preference — stored two-way/pull overrides are ignored)
 * while their per-company `enabled` flag survives; `payment` is forced
 * `two-way` AND enabled (inbound pull + outbound push must both work as soon
 * as the integration is connected — there is no per-company toggle for it,
 * and the documents-mode families gate governs whether it actually runs);
 * everything else is force-disabled.
 */
export function buildRilletSyncConfig(
  resolved: GlobalSyncConfig
): GlobalSyncConfig {
  const entities = Object.fromEntries(
    Object.entries(resolved.entities).map(([entityType, entityConfig]) => [
      entityType,
      { ...entityConfig }
    ])
  ) as GlobalSyncConfig["entities"];

  for (const entityType of RILLET_PUSH_ONLY_ENTITIES) {
    entities[entityType] = {
      ...entities[entityType],
      direction: "push-to-accounting",
      owner: "carbon"
    };
  }

  for (const entityType of RILLET_TWO_WAY_ENTITIES) {
    entities[entityType] = {
      ...entities[entityType],
      direction: "two-way",
      owner: "accounting",
      enabled: true
    };
  }

  for (const entityType of RILLET_DISABLED_ENTITIES) {
    entities[entityType] = { ...entities[entityType], enabled: false };
  }

  // Always-on: automated postings sync whenever the integration is connected.
  // Forced here (defense-in-depth over the DEFAULT_SYNC_CONFIG default) so a
  // stale stored `enabled: false` override can't silently turn journals off.
  entities.journalEntry = { ...entities.journalEntry, enabled: true };

  return { entities };
}

// /********************************************************\
// *                      Provider                          *
// \********************************************************/

type RilletProviderConfig = ProviderConfig<{
  /**
   * Credentials parsed from `companyIntegration.metadata.credentials`
   * (parseStoredCredentials). Expected to be the `apiKey` variant; absent
   * until an API key is entered on the integration settings page.
   */
  credentials?: ProviderCredentials;
}> & { id: ProviderID.RILLET };

const NO_OAUTH_MESSAGE =
  "Rillet authenticates with an API key entered on the integration settings page — there is no OAuth flow";

function getRilletApiKeyCredentials(
  credentials: ProviderCredentials
): Extract<ProviderCredentials, { type: "apiKey" }> {
  if (credentials.type !== "apiKey") {
    throw new Error(
      `Rillet requires apiKey credentials, received "${credentials.type}"`
    );
  }
  return credentials;
}

/**
 * Rillet single-object endpoints are documented as returning the bare
 * object, but be defensive about a wrapped envelope (e.g.
 * `{ journal_entry: {...} }`) — accept both.
 */
function unwrapRilletEntity<T>(data: unknown, envelopeKey: string): T | null {
  if (data === null || typeof data !== "object") return null;
  const wrapped = (data as Record<string, unknown>)[envelopeKey];
  if (wrapped && typeof wrapped === "object") return wrapped as T;
  return data as T;
}

export class RilletProvider extends BaseProvider {
  static id = ProviderID.RILLET;

  readonly capabilities: ProviderCapabilities = {
    transport: "rest",
    supportsWebhooks: true,
    supportsJournalPush: true
  };

  /** No cap: /invoice-payments `updated.gt` reaches arbitrarily far back. */
  readonly pullLookbackDays?: number;

  http: HTTPClient;

  private readonly syncConfig: GlobalSyncConfig;

  constructor(public config: Omit<RilletProviderConfig, "id">) {
    super();
    this.creds = config.credentials;
    this.syncConfig = buildRilletSyncConfig(config.syncConfig);

    // API keys are environment-specific — the stored credentials pick the host
    const environment =
      config.credentials?.type === "apiKey"
        ? config.credentials.environment
        : "production";
    this.http = new HTTPClient(
      environment === "sandbox" ? RILLET_SANDBOX_HOST : RILLET_PRODUCTION_HOST
    );

    // No OAuth client: the API key IS the whole connection. getCredentials
    // still works so generic code can read the stored credentials.
    const auth: AuthProvider = {
      getCredentials: () => {
        if (!this.creds) {
          throw new Error(
            "Rillet integration has no stored credentials — enter an API key on the integration settings page"
          );
        }
        return this.creds;
      },
      getAuthUrl: () => {
        throw new Error(NO_OAUTH_MESSAGE);
      },
      exchangeCode: () => {
        throw new Error(NO_OAUTH_MESSAGE);
      },
      refresh: () => {
        throw new Error(NO_OAUTH_MESSAGE);
      }
    };
    this.auth = auth;
  }

  get id(): ProviderID.RILLET {
    return ProviderID.RILLET;
  }

  getSyncConfig(entity: AccountingEntityType) {
    return this.syncConfig.entities[entity];
  }

  async authenticate(): Promise<ProviderCredentials> {
    throw new Error(NO_OAUTH_MESSAGE);
  }

  /** `providerMetadata.subsidiaryId` when configured, else null. */
  get subsidiaryId(): string | null {
    if (this.creds?.type !== "apiKey") return null;
    const value = this.creds.providerMetadata?.subsidiaryId;
    return typeof value === "string" && value.length > 0 ? value : null;
  }

  /** `providerMetadata.webhookToken` — the inbound webhook route's shared secret. */
  get webhookToken(): string | null {
    if (this.creds?.type !== "apiKey") return null;
    const value = this.creds.providerMetadata?.webhookToken;
    return typeof value === "string" && value.length > 0 ? value : null;
  }

  /**
   * Perform an authenticated Rillet request. Every call carries the bearer
   * API key and the pinned X-Rillet-API-Version. There is NO 401-refresh
   * retry: API keys don't refresh, so a 401 is terminal (revoked/wrong
   * key). HTTPClient already converts 429 into a RatelimitError.
   */
  async request<T>(
    method: string,
    url: string,
    options?: RequestInit & { idempotencyKey?: string }
  ): Promise<HttpResponse<T>> {
    const credentials = getRilletApiKeyCredentials(this.auth.getCredentials());
    const { idempotencyKey, ...init } = options ?? {};

    const headers: Record<string, string> = {
      Authorization: `Bearer ${credentials.apiKey}`,
      "X-Rillet-API-Version": RILLET_API_VERSION,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      ...((init.headers ?? {}) as Record<string, string>)
    };

    return this.http.request<T>(method, url, { ...init, headers });
  }

  /**
   * Drain a cursor-paginated list endpoint (`?limit=100&cursor=...` →
   * `pagination.next_cursor`, absent on the last page) in ONE pass —
   * Rillet cursors expire after 2 hours, so pagination is never resumed
   * across runs.
   */
  private async listPaginated<T>(
    path: string,
    extractRows: (data: Record<string, unknown>) => T[] | undefined
  ): Promise<T[]> {
    const rows: T[] = [];
    let cursor: string | undefined;

    do {
      const separator = path.includes("?") ? "&" : "?";
      const url = `${path}${separator}limit=${RILLET_PAGE_SIZE}${
        cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
      }`;

      const response = await this.request<Record<string, unknown>>("GET", url);
      if (response.error) {
        throwRilletApiError(`list ${path}`, response);
      }

      rows.push(...(extractRows(response.data ?? {}) ?? []));

      const pagination = (
        response.data as {
          pagination?: { next_cursor?: string | null };
        } | null
      )?.pagination;
      cursor = pagination?.next_cursor ?? undefined;
    } while (cursor);

    return rows;
  }

  /** Credentials work iff GET /accounts succeeds. */
  async validate(): Promise<boolean> {
    try {
      const response = await this.request<{ accounts?: Rillet.Account[] }>(
        "GET",
        "/accounts"
      );
      return !response.error;
    } catch (error) {
      console.error("Rillet validate error:", error);
      return false;
    }
  }

  // =================================================================
  // Chart of accounts
  // =================================================================

  /**
   * Fetch the active Rillet chart of accounts, normalized to the
   * `{ id, code, name }` shape the settings loader / account-mapping UI
   * consumes. INACTIVE and code-less accounts are dropped — journal/bill
   * items address accounts by CODE. Returns [] on failure, mirroring the
   * Xero/QBO forgiving contract.
   */
  async listChartOfAccounts(): Promise<
    Array<{ id: string; code: string; name: string }>
  > {
    try {
      // GET /accounts is documented unpaginated
      const response = await this.request<{ accounts?: Rillet.Account[] }>(
        "GET",
        "/accounts"
      );
      if (response.error) {
        throwRilletApiError("list accounts", response);
      }

      const accounts = response.data?.accounts ?? [];
      return accounts
        .filter((account) => account.status === "ACTIVE" && account.code)
        .map((account) => ({
          id: account.id,
          code: account.code!,
          name: account.name ?? account.code!
        }));
    } catch (error) {
      console.error("Failed to fetch Rillet accounts:", error);
      return [];
    }
  }

  /**
   * Fetch the Rillet subsidiaries (multi-entity ledger; the configured
   * `providerMetadata.subsidiaryId` scopes every pushed document). Returns
   * [] on failure — a settings-surface read, same forgiving contract as
   * listChartOfAccounts.
   */
  async listSubsidiaries(): Promise<Rillet.Subsidiary[]> {
    try {
      return await this.listPaginated<Rillet.Subsidiary>(
        "/subsidiaries",
        (data) => data.subsidiaries as Rillet.Subsidiary[] | undefined
      );
    } catch (error) {
      console.error("Failed to fetch Rillet subsidiaries:", error);
      return [];
    }
  }

  // =================================================================
  // Fields (dimensions) — verified v4 surface (spec changelog 2026-08-04)
  // =================================================================

  /**
   * Fetch the Rillet Field definitions with their pick-list values
   * (GET /fields → `{ fields: [...] }`). The endpoint is documented
   * unpaginated, but a cursor is followed defensively if one ever
   * appears. Throws a structured error on API failure.
   */
  async listFields(): Promise<Rillet.Field[]> {
    const fields: Rillet.Field[] = [];
    let cursor: string | undefined;

    do {
      const url = `/fields${
        cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""
      }`;
      const response = await this.request<Record<string, unknown>>("GET", url);
      if (response.error) {
        throwRilletApiError("list fields", response);
      }

      const data = response.data ?? {};
      fields.push(...((data.fields as Rillet.Field[] | undefined) ?? []));

      const pagination = (
        data as { pagination?: { next_cursor?: string | null } }
      ).pagination;
      cursor = pagination?.next_cursor ?? undefined;
    } while (cursor);

    return fields;
  }

  /**
   * The journal dimension targets this org supports: one
   * `field:<fieldId>` target per Rillet Field (dimension-native — no
   * structural cap). Returns [] on failure, mirroring the forgiving
   * settings-surface contract of listChartOfAccounts.
   */
  async journalDimensionTargets(): Promise<DimensionTarget[]> {
    try {
      const fields = await this.listFields();
      return fields.map((field) => ({
        id: buildRilletFieldTarget(field.id),
        label: field.name,
        capacity: 1
      }));
    } catch (error) {
      console.error("Failed to fetch Rillet fields:", error);
      return [];
    }
  }

  /**
   * Upsert a Field pick-list value BY NAME
   * (POST /fields/{id}/values `{ name }`) — Rillet returns the FULL Field
   * including the created value's uuid. NOT idempotent server-side (verified
   * on sandbox 2026-08-14: a name that already exists — e.g. provisioned by
   * an earlier Carbon instance whose mappings are gone, or seeded in the
   * Rillet UI — 400s `Value "<name>" already exists`), so on that rejection
   * the existing value is recovered by name via `GET /fields` (there is no
   * `GET /fields/{id}` — 405). Throws when Rillet accepts the write but the
   * value cannot be found on the returned Field (contract drift — fail loud,
   * not with a broken ref).
   */
  async upsertFieldValue(
    fieldId: string,
    rawName: string
  ): Promise<Rillet.FieldValue> {
    // Rillet TRIMS value names on write and dedupes them trim-insensitively
    // (verified on sandbox 2026-08-14: creating "Test " comes back stored as
    // "Test", and a later POST of "Test" 400s `already exists`). Carbon's
    // dimension labels can carry inconsistent whitespace across lines ("Test"
    // vs "Test "), so we normalize to Rillet's own behavior — trim on write and
    // match trimmed on both sides — so those resolve to ONE Field value instead
    // of failing the whole journal on an exact-string miss.
    const name = rawName.trim();
    let field: Rillet.Field;
    try {
      field = await this.writeEntity<Rillet.Field>({
        method: "POST",
        path: `/fields/${fieldId}/values`,
        envelopeKey: "field",
        operation: "upsert field value",
        payload: { name }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/already exists/i.test(message)) {
        const existingField = (await this.listFields()).find(
          (candidate) => candidate.id === fieldId
        );
        const existingValue =
          existingField?.values?.find(
            (candidate) =>
              candidate.name?.trim() === name && !candidate.deactivated
          ) ??
          existingField?.values?.find(
            (candidate) => candidate.name?.trim() === name
          );
        if (existingValue) return existingValue;
      }
      throw err;
    }

    const value = (field.values ?? []).find(
      (candidate) => candidate.name?.trim() === name
    );
    if (!value) {
      throw new Error(
        `Rillet accepted the field-value upsert but "${name}" is not on the returned field ${fieldId}`
      );
    }

    return value;
  }

  /**
   * Create a Field definition (a whole dimension) BY NAME
   * (POST /fields). `area` is the applicability scope — EXPENSES covers
   * bills + manual journal entries, REVENUE covers invoices/credit memos —
   * written as `settings.<AREA> = { mandatory, display }` with display
   * STANDALONE (single-select; one value per line per Carbon dimension).
   * Unlike upsertFieldValue this is NOT idempotent by name server-side, so
   * callers must check for an existing Field first (see resolveLineDimensions)
   * and pass a deterministic Idempotency-Key to guard a create-retry.
   *
   * VERIFY: the POST /fields request body is inferred from the documented
   * GET /fields shape (v3 spec changelog 2026-08-04) — confirm against the
   * live Rillet sandbox before relying on auto-provisioning in production.
   */
  async createField(
    name: string,
    area: "EXPENSES" | "REVENUE",
    idempotencyKey?: string
  ): Promise<Rillet.Field> {
    return this.writeEntity<Rillet.Field>({
      method: "POST",
      path: "/fields",
      envelopeKey: "field",
      operation: "create field",
      payload: {
        name,
        settings: { [area]: { mandatory: false, display: "STANDALONE" } }
      },
      idempotencyKey
    });
  }

  /** All Rillet customers (cursor-drained). Throws on API failure. */
  async listCustomers(): Promise<Rillet.Customer[]> {
    return this.listPaginated<Rillet.Customer>(
      "/customers",
      (data) => data.customers as Rillet.Customer[] | undefined
    );
  }

  /** All Rillet vendors (cursor-drained). Throws on API failure. */
  async listVendors(): Promise<Rillet.Vendor[]> {
    return this.listPaginated<Rillet.Vendor>(
      "/vendors",
      (data) => data.vendors as Rillet.Vendor[] | undefined
    );
  }

  // =================================================================
  // Entity reads/writes (reads return null on failure; writes throw a
  // structured AccountingApiError; creates carry an Idempotency-Key)
  // =================================================================

  private async readEntity<T>(
    path: string,
    envelopeKey: string
  ): Promise<T | null> {
    const response = await this.request<unknown>("GET", path);
    if (response.error) return null;
    return unwrapRilletEntity<T>(response.data, envelopeKey);
  }

  private async writeEntity<T>(args: {
    method: "POST" | "PUT";
    path: string;
    envelopeKey: string;
    operation: string;
    payload: unknown;
    idempotencyKey?: string;
  }): Promise<T> {
    const response = await this.request<unknown>(args.method, args.path, {
      body: JSON.stringify(args.payload),
      idempotencyKey: args.idempotencyKey
    });

    if (response.error) {
      throwRilletApiError(args.operation, response);
    }

    const entity = unwrapRilletEntity<T>(response.data, args.envelopeKey);
    if (!entity) {
      throw new Error(
        `Rillet returned success but no ${args.envelopeKey} body for ${args.operation}`
      );
    }

    return entity;
  }

  async getJournalEntry(id: string): Promise<Rillet.JournalEntry | null> {
    return this.readEntity<Rillet.JournalEntry>(
      `/journal-entries/${id}`,
      "journal_entry"
    );
  }

  /**
   * Create a Rillet journal entry. No update counterpart: pushed journals
   * are immutable (the journal syncer hard-skips already-mapped ids).
   */
  async createJournalEntry(
    journalEntry: RilletJournalEntryCreate,
    idempotencyKey?: string
  ): Promise<Rillet.JournalEntry> {
    return this.writeEntity({
      method: "POST",
      path: "/journal-entries",
      envelopeKey: "journal_entry",
      operation: "create journal entry",
      payload: journalEntry,
      idempotencyKey
    });
  }

  async getCustomer(id: string): Promise<Rillet.Customer | null> {
    return this.readEntity<Rillet.Customer>(`/customers/${id}`, "customer");
  }

  async createCustomer(
    customer: RilletCustomerWrite,
    idempotencyKey?: string
  ): Promise<Rillet.Customer> {
    return this.writeEntity({
      method: "POST",
      path: "/customers",
      envelopeKey: "customer",
      operation: "create customer",
      payload: customer,
      idempotencyKey
    });
  }

  async updateCustomer(
    id: string,
    customer: RilletCustomerWrite
  ): Promise<Rillet.Customer> {
    return this.writeEntity({
      method: "PUT",
      path: `/customers/${id}`,
      envelopeKey: "customer",
      operation: "update customer",
      payload: customer
    });
  }

  async getVendor(id: string): Promise<Rillet.Vendor | null> {
    return this.readEntity<Rillet.Vendor>(`/vendors/${id}`, "vendor");
  }

  async createVendor(
    vendor: RilletVendorWrite,
    idempotencyKey?: string
  ): Promise<Rillet.Vendor> {
    return this.writeEntity({
      method: "POST",
      path: "/vendors",
      envelopeKey: "vendor",
      operation: "create vendor",
      payload: vendor,
      idempotencyKey
    });
  }

  async updateVendor(
    id: string,
    vendor: RilletVendorWrite
  ): Promise<Rillet.Vendor> {
    return this.writeEntity({
      method: "PUT",
      path: `/vendors/${id}`,
      envelopeKey: "vendor",
      operation: "update vendor",
      payload: vendor
    });
  }

  async getProduct(id: string): Promise<Rillet.Product | null> {
    return this.readEntity<Rillet.Product>(`/products/${id}`, "product");
  }

  async createProduct(
    product: RilletProductWrite,
    idempotencyKey?: string
  ): Promise<Rillet.Product> {
    return this.writeEntity({
      method: "POST",
      path: "/products",
      envelopeKey: "product",
      operation: "create product",
      payload: product,
      idempotencyKey
    });
  }

  async updateProduct(
    id: string,
    product: RilletProductWrite
  ): Promise<Rillet.Product> {
    return this.writeEntity({
      method: "PUT",
      path: `/products/${id}`,
      envelopeKey: "product",
      operation: "update product",
      payload: product
    });
  }

  async getInvoice(id: string): Promise<Rillet.Invoice | null> {
    return this.readEntity<Rillet.Invoice>(`/invoices/${id}`, "invoice");
  }

  /** Create an AR_ONLY invoice (Carbon invoices; Rillet carries the receivable). */
  async createInvoice(
    invoice: RilletInvoiceCreate,
    idempotencyKey?: string
  ): Promise<Rillet.Invoice> {
    return this.writeEntity({
      method: "POST",
      path: "/invoices",
      envelopeKey: "invoice",
      operation: "create invoice",
      payload: invoice,
      idempotencyKey
    });
  }

  async getBill(id: string): Promise<Rillet.Bill | null> {
    return this.readEntity<Rillet.Bill>(`/bills/${id}`, "bill");
  }

  async createBill(
    bill: RilletBillCreate,
    idempotencyKey?: string
  ): Promise<Rillet.Bill> {
    return this.writeEntity({
      method: "POST",
      path: "/bills",
      envelopeKey: "bill",
      operation: "create bill",
      payload: bill,
      idempotencyKey
    });
  }

  /**
   * Payments recorded against one invoice. Throws on API failure (unlike
   * the getX reads) — the payment pull needs to distinguish "invoice has
   * no such payment" from "the listing itself failed".
   */
  async listInvoicePayments(
    invoiceId: string
  ): Promise<Rillet.InvoicePayment[]> {
    const response = await this.request<{
      payments?: Rillet.InvoicePayment[];
    }>("GET", `/invoices/${invoiceId}/payments`);

    if (response.error) {
      throwRilletApiError("list invoice payments", response);
    }

    return response.data?.payments ?? [];
  }

  /**
   * All invoice payments in the organization changed since `updatedAfter`
   * (GET /invoice-payments — org-wide; no subsidiary or invoice filter
   * exists on this endpoint).
   */
  async listInvoicePaymentsUpdatedSince(
    updatedAfter: string
  ): Promise<Rillet.InvoicePayment[]> {
    return this.listPaginated<Rillet.InvoicePayment>(
      `/invoice-payments?updated.gt=${encodeURIComponent(
        updatedAfter
      )}&sort_by=updated`,
      (data) => data.payments as Rillet.InvoicePayment[] | undefined
    );
  }

  /**
   * Payments recorded against one bill (AP mirror of listInvoicePayments).
   * Throws on API failure so the pull can distinguish "bill has no such
   * payment" from "the listing itself failed".
   *
   * VERIFY: the `GET /bills/{billId}/payments` endpoint and its `{ payments:
   * [...] }` envelope are assumed to mirror `/invoices/{id}/payments`; not yet
   * confirmed against the live Rillet OpenAPI.
   */
  async listBillPayments(billId: string): Promise<Rillet.BillPayment[]> {
    const response = await this.request<{
      payments?: Rillet.BillPayment[];
    }>("GET", `/bills/${billId}/payments`);

    if (response.error) {
      throwRilletApiError("list bill payments", response);
    }

    return response.data?.payments ?? [];
  }

  /**
   * Bills changed since `updatedAfter` (VERIFIED on sandbox 2026-08-13:
   * `GET /bills?updated.gt` returns the `{ bills, pagination }` envelope,
   * accepts `sort_by=updated`, and paying a bill bumps its `updated_at` —
   * so the bill feed is a complete change signal for payment activity).
   */
  async listBillsUpdatedSince(updatedAfter: string): Promise<Rillet.Bill[]> {
    return this.listPaginated<Rillet.Bill>(
      `/bills?updated.gt=${encodeURIComponent(updatedAfter)}&sort_by=updated`,
      (data) => data.bills as Rillet.Bill[] | undefined
    );
  }

  /**
   * All bill payments in the organization changed since `updatedAfter`
   * (AP mirror of listInvoicePaymentsUpdatedSince).
   *
   * There is NO org-wide bill-payment feed: `GET /bill-payments` does not
   * exist (VERIFIED on sandbox 2026-08-13 — 404, which threw here and killed
   * every pull sweep). Composed instead from the two endpoints that do
   * exist: bills changed since the cursor (payment activity bumps the
   * bill's `updated_at`), then each changed bill's payments via
   * GET /bills/{id}/payments. Costs one extra request per changed bill,
   * bounded by the sweep window. Bill payments from the per-bill endpoint
   * carry no `updated_at` of their own, so each is stamped with its bill's
   * — the change signal that surfaced it.
   */
  async listBillPaymentsUpdatedSince(
    updatedAfter: string
  ): Promise<Rillet.BillPayment[]> {
    const bills = await this.listBillsUpdatedSince(updatedAfter);

    const payments: Rillet.BillPayment[] = [];
    for (const bill of bills) {
      const billPayments = await this.listBillPayments(bill.id);
      for (const payment of billPayments) {
        payments.push({
          ...payment,
          bill_id: payment.bill_id ?? bill.id,
          updated_at: payment.updated_at ?? bill.updated_at
        });
      }
    }
    return payments;
  }

  /**
   * Record a payment against one AR invoice (Phase G outbound write-back for a
   * Carbon-born payment). Returns the created Rillet payment so its id can seed
   * the composite mapping. Idempotency-Key protects against double-create on a
   * push retry (Rillet replays the stored response for 24h).
   *
   * Request body is FLAT (writeEntity never wraps requests; envelopeKey only
   * unwraps responses, and unwrapRilletEntity falls back to the flat object).
   * VERIFIED on the bill mirror (sandbox 2026-08-11): flat body with `date`
   * (not `payment_date`), flat response payment object. The invoice path is
   * assumed to mirror it; not separately confirmed.
   */
  async createInvoicePayment(
    invoiceId: string,
    payment: RilletPaymentCreate,
    idempotencyKey?: string
  ): Promise<Rillet.InvoicePayment> {
    return this.writeEntity({
      method: "POST",
      path: `/invoices/${invoiceId}/payments`,
      envelopeKey: "payment",
      operation: "create invoice payment",
      payload: payment,
      idempotencyKey
    });
  }

  /**
   * Record a payment against one AP bill (AP mirror of createInvoicePayment).
   *
   * VERIFIED (sandbox 2026-08-11): POST /bills/{id}/payments takes a FLAT
   * body `{ amount, date, account_code, external_references? }` — `payment_date`
   * 400s ("date must not be null") — and returns the created payment FLAT
   * (`{ id, status, bill_id, amount, date, account_code }`, status UNCLEARED);
   * unwrapRilletEntity's flat fallback handles it.
   */
  async createBillPayment(
    billId: string,
    payment: RilletPaymentCreate,
    idempotencyKey?: string
  ): Promise<Rillet.BillPayment> {
    return this.writeEntity({
      method: "POST",
      path: `/bills/${billId}/payments`,
      envelopeKey: "payment",
      operation: "create bill payment",
      payload: payment,
      idempotencyKey
    });
  }

  /**
   * SupportsIncrementalPull: invoice AND bill payments changed since `since`,
   * for the generic accounting-pull-sweep cron. Both feeds are organization-
   * wide while this instance owns one subsidiary, so every change carries a
   * dependsOnMapping on its document (invoice for AR, bill for AP) — the sweep
   * drops changes whose document has no local mapping (another instance's
   * subsidiary, or a document created directly in Rillet) without ledger noise.
   * Payments missing their document id cannot be addressed (composite id) and
   * are logged and dropped.
   */
  async listChanges(args: { since: string }): Promise<ListChangesResult> {
    const paymentConfig = this.getSyncConfig("payment");
    if (!paymentConfig.enabled) {
      return { changes: [] };
    }

    const changes: ProviderChange[] = [];

    // AR — invoice payments settle Carbon sales invoices.
    const invoicePayments = await this.listInvoicePaymentsUpdatedSince(
      args.since
    );
    for (const payment of invoicePayments) {
      if (!payment.invoice_id) {
        console.warn(
          `[Rillet] ignoring invoice payment ${payment.id} with no invoice_id`
        );
        continue;
      }
      changes.push({
        entityType: "payment",
        remoteId: getRilletPaymentSyncEntityId(payment.invoice_id, payment.id),
        updatedAt: payment.updated_at ?? null,
        dependsOnMapping: {
          entityType: "invoice",
          remoteId: payment.invoice_id
        }
      });
    }

    // AP — bill payments settle Carbon purchase invoices. Poll is the
    // correctness guarantee: Rillet documents no bill-payment webhook event
    // (only bill-created/updated/deleted), so this feed is the only mechanism.
    const billPayments = await this.listBillPaymentsUpdatedSince(args.since);
    for (const payment of billPayments) {
      if (!payment.bill_id) {
        console.warn(
          `[Rillet] ignoring bill payment ${payment.id} with no bill_id`
        );
        continue;
      }
      changes.push({
        entityType: "payment",
        remoteId: getRilletBillPaymentSyncEntityId(payment.bill_id, payment.id),
        updatedAt: payment.updated_at ?? null,
        dependsOnMapping: {
          entityType: "bill",
          remoteId: payment.bill_id
        }
      });
    }

    return { changes };
  }
}
