import { restBaseUrl } from "./account.ts";
import { kindForStatus, NetSuiteError, parseErrorBody } from "./errors.ts";
import { signTbaRequest, type TbaCredentials } from "./tba.ts";
import { backoffDelay, Semaphore } from "./throttle.ts";

export type NetSuiteAuth =
  | ({ type: "tba" } & TbaCredentials)
  /**
   * OAuth 2.0 is supported for the access token a customer already holds, but
   * the migration does NOT own the refresh dance: NetSuite access tokens live
   * 60 minutes and a full migration can outlive that. `refreshAccessToken` lets
   * the caller re-mint one on demand; without it a long run fails mid-way with
   * an `auth` error, which the job reports rather than silently truncating.
   */
  | {
      type: "oauth2";
      accountId: string;
      accessToken: string;
      refreshAccessToken?: () => Promise<string>;
    };

export type SuiteQLPage<T> = {
  items: T[];
  hasMore: boolean;
  offset: number;
  count: number;
  totalResults: number;
};

export type NetSuiteClientOptions = {
  auth: NetSuiteAuth;
  /**
   * Stay under the account's concurrency allotment. Default 4 leaves headroom
   * on the 5-request allotment most NetSuite tiers grant per integration, so a
   * migration does not starve the customer's other integrations.
   */
  concurrency?: number;
  maxRetries?: number;
  /** Injected in tests; defaults to global fetch. */
  fetch?: typeof fetch;
  /** Injected in tests so retries do not actually sleep. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  onRequest?: (info: {
    method: string;
    url: string;
    status?: number;
    attempt: number;
    durationMs: number;
  }) => void;
};

const DEFAULT_SLEEP = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

/** NetSuite's OFFSET ceiling for SuiteQL without SuiteAnalytics Connect. */
export const SUITEQL_MAX_OFFSET = 100_000;

export class NetSuiteClient {
  private readonly auth: NetSuiteAuth;
  private readonly base: string;
  private readonly semaphore: Semaphore;
  private readonly maxRetries: number;
  private readonly doFetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly onRequest: NetSuiteClientOptions["onRequest"];
  private accessToken: string | undefined;

  constructor(options: NetSuiteClientOptions) {
    this.auth = options.auth;
    this.base = restBaseUrl(options.auth.accountId);
    this.semaphore = new Semaphore(options.concurrency ?? 4);
    this.maxRetries = options.maxRetries ?? 5;
    this.doFetch = options.fetch ?? globalThis.fetch;
    this.sleep = options.sleep ?? DEFAULT_SLEEP;
    this.random = options.random ?? Math.random;
    this.onRequest = options.onRequest;
    this.accessToken =
      options.auth.type === "oauth2" ? options.auth.accessToken : undefined;
  }

  /** `https://<host>/services/rest` — exposed so callers can log what they hit. */
  get baseUrl(): string {
    return this.base;
  }

  private authorization(method: string, url: URL): string {
    if (this.auth.type === "tba") {
      return signTbaRequest(this.auth, method, url);
    }
    return `Bearer ${this.accessToken}`;
  }

  async request<T>(
    method: string,
    path: string,
    options: {
      query?: Record<string, string | number | undefined>;
      body?: unknown;
      headers?: Record<string, string>;
      /** Set false for endpoints whose 404 is a real answer (feature probing). */
      throwOnNotFound?: boolean;
    } = {}
  ): Promise<T> {
    const url = new URL(path.startsWith("http") ? path : `${this.base}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    let refreshed = false;

    for (let attempt = 0; ; attempt += 1) {
      const startedAt = Date.now();
      let response: Response;

      try {
        response = await this.semaphore.run(() =>
          this.doFetch(url.toString(), {
            method,
            headers: {
              Authorization: this.authorization(method, url),
              "Content-Type": "application/json",
              Accept: "application/json",
              ...options.headers
            },
            body:
              options.body === undefined
                ? undefined
                : JSON.stringify(options.body)
          })
        );
      } catch (cause) {
        this.onRequest?.({
          method,
          url: url.toString(),
          attempt,
          durationMs: Date.now() - startedAt
        });
        if (attempt >= this.maxRetries) {
          throw new NetSuiteError(`Could not reach NetSuite at ${url.host}`, {
            kind: "network",
            cause
          });
        }
        await this.sleep(backoffDelay(attempt, { random: this.random }));
        continue;
      }

      this.onRequest?.({
        method,
        url: url.toString(),
        status: response.status,
        attempt,
        durationMs: Date.now() - startedAt
      });

      if (response.ok) {
        if (response.status === 204) return undefined as T;
        const text = await response.text();
        return (text ? JSON.parse(text) : undefined) as T;
      }

      if (response.status === 404 && options.throwOnNotFound === false) {
        return undefined as T;
      }

      const operationId =
        response.headers.get("x-netsuite-operation-id") ??
        response.headers.get("x-n-operationid") ??
        undefined;
      const raw = await response.text();
      let parsed: { detail?: string; code?: string } = {};
      try {
        parsed = parseErrorBody(raw ? JSON.parse(raw) : undefined);
      } catch {
        parsed = { detail: raw.slice(0, 500) || undefined };
      }

      const kind = kindForStatus(response.status);

      // An expired OAuth 2.0 access token looks exactly like bad credentials.
      // Try exactly one refresh before believing it.
      if (
        kind === "auth" &&
        !refreshed &&
        this.auth.type === "oauth2" &&
        this.auth.refreshAccessToken
      ) {
        refreshed = true;
        this.accessToken = await this.auth.refreshAccessToken();
        continue;
      }

      const error = new NetSuiteError(
        parsed.detail ??
          `NetSuite ${method} ${url.pathname} failed (${response.status})`,
        {
          kind,
          status: response.status,
          detail: parsed.detail,
          code: parsed.code,
          operationId
        }
      );

      if (!error.retryable || attempt >= this.maxRetries) throw error;

      const retryAfter = Number(response.headers.get("retry-after"));
      await this.sleep(
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : backoffDelay(attempt, { random: this.random })
      );
    }
  }

  /**
   * One page of SuiteQL. `Prefer: transient` is REQUIRED — without it NetSuite
   * answers 400 with a message about an unsupported prefer header, which reads
   * like a query error and sends you debugging the SQL.
   */
  async suiteQL<T>(
    q: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<SuiteQLPage<T>> {
    const limit = Math.min(options.limit ?? 1000, 1000);
    const offset = options.offset ?? 0;

    const page = await this.request<{
      items?: T[];
      hasMore?: boolean;
      offset?: number;
      count?: number;
      totalResults?: number;
    }>("POST", "/query/v1/suiteql", {
      query: { limit, offset },
      headers: { Prefer: "transient" },
      body: { q }
    });

    return {
      items: page?.items ?? [],
      hasMore: page?.hasMore ?? false,
      offset: page?.offset ?? offset,
      count: page?.count ?? page?.items?.length ?? 0,
      totalResults: page?.totalResults ?? 0
    };
  }

  /**
   * Every row of a SuiteQL query, page by page, using OFFSET.
   *
   * Only safe for bounded lookups. NetSuite caps `offset` at 100,000 without
   * SuiteAnalytics Connect, and a query that reaches the cap stops returning
   * rows with no error at all — so this refuses at the cap rather than quietly
   * handing back a truncated chart of accounts. Anything that can exceed it
   * (items, transactions, transaction lines) must use `suiteQLKeyset`.
   *
   * `maxRows` is a guard rail, not a feature: a migration that silently pulls
   * 4 million transaction lines is a runaway, and the caller wants to be told
   * it was truncated so it can land in the gap report rather than look complete.
   */
  async *suiteQLAll<T>(
    q: string,
    options: { pageSize?: number; maxRows?: number } = {}
  ): AsyncGenerator<T[], void, void> {
    const pageSize = Math.min(options.pageSize ?? 1000, 1000);
    const maxRows = options.maxRows ?? Number.POSITIVE_INFINITY;
    let offset = 0;
    let yielded = 0;

    while (yielded < maxRows) {
      if (offset > SUITEQL_MAX_OFFSET) {
        throw new NetSuiteError(
          `This query passed NetSuite's ${SUITEQL_MAX_OFFSET.toLocaleString()}-row offset ceiling — it must be read with keyset pagination instead`,
          { kind: "invalid-request", detail: q.slice(0, 200) }
        );
      }

      const page = await this.suiteQL<T>(q, { limit: pageSize, offset });
      if (page.items.length === 0) return;

      const remaining = maxRows - yielded;
      const items =
        page.items.length > remaining
          ? page.items.slice(0, remaining)
          : page.items;
      yielded += items.length;
      yield items;

      if (!page.hasMore || items.length < page.items.length) return;
      offset += page.items.length;
    }
  }

  /**
   * Every row of a SuiteQL query, page by page, using KEYSET pagination.
   *
   * `build` receives the last id of the previous page (null on the first) and
   * must return a query that is ordered by that same id ascending and filtered
   * to rows after it. This is the default strategy for anything unbounded: it
   * ignores the offset ceiling entirely, and — unlike OFFSET, which re-runs the
   * whole query per page against a table other people are still writing to — it
   * cannot silently skip or repeat a row.
   */
  async *suiteQLKeyset<T extends Record<string, unknown>>(
    build: (afterId: string | null) => string,
    options: { pageSize?: number; maxRows?: number; idColumn?: string } = {}
  ): AsyncGenerator<T[], void, void> {
    const pageSize = Math.min(options.pageSize ?? 1000, 1000);
    const maxRows = options.maxRows ?? Number.POSITIVE_INFINITY;
    const idColumn = options.idColumn ?? "id";

    let cursor: string | null = null;
    let yielded = 0;

    while (yielded < maxRows) {
      const page: SuiteQLPage<T> = await this.suiteQL<T>(build(cursor), {
        limit: pageSize
      });
      if (page.items.length === 0) return;

      const remaining = maxRows - yielded;
      const items =
        page.items.length > remaining
          ? page.items.slice(0, remaining)
          : page.items;
      yielded += items.length;
      yield items;

      if (items.length < page.items.length) return;

      const last: T | undefined = page.items[page.items.length - 1];
      const nextCursor: unknown = last?.[idColumn];
      if (nextCursor === undefined || nextCursor === null) {
        throw new NetSuiteError(
          `Keyset pagination needs "${idColumn}" in the SELECT list, and this query does not return it`,
          { kind: "invalid-request" }
        );
      }
      const nextCursorText: string = String(nextCursor);
      // A page that does not advance the cursor would loop forever — which is
      // exactly what a non-unique ORDER BY column produces.
      if (nextCursorText === cursor) return;
      cursor = nextCursorText;

      if (!page.hasMore && page.items.length < pageSize) return;
    }
  }

  /** Collect an OFFSET-paginated query into one array. For bounded lookups only. */
  async suiteQLRows<T>(
    q: string,
    options: { pageSize?: number; maxRows?: number } = {}
  ): Promise<T[]> {
    const rows: T[] = [];
    for await (const page of this.suiteQLAll<T>(q, options)) rows.push(...page);
    return rows;
  }

  /** Collect a KEYSET-paginated query into one array. The default for large tables. */
  async suiteQLKeysetRows<T extends Record<string, unknown>>(
    build: (afterId: string | null) => string,
    options: { pageSize?: number; maxRows?: number; idColumn?: string } = {}
  ): Promise<T[]> {
    const rows: T[] = [];
    for await (const page of this.suiteQLKeyset<T>(build, options))
      rows.push(...page);
    return rows;
  }

  /** One record from the REST record service, sublists expanded inline. */
  async getRecord<T>(
    recordType: string,
    id: string,
    options: { expandSubResources?: boolean } = {}
  ): Promise<T> {
    return this.request<T>(
      "GET",
      `/record/v1/${recordType}/${encodeURIComponent(id)}`,
      {
        query:
          options.expandSubResources === false
            ? {}
            : { expandSubResources: "true" }
      }
    );
  }

  /**
   * Probe whether a record type is reachable for these credentials. A migration
   * runs against accounts with wildly different enabled features, and the
   * difference between "no assemblies" and "Assemblies feature is off" is a gap
   * report entry, not a crash.
   */
  async canReadRecordType(recordType: string): Promise<boolean> {
    try {
      await this.request("GET", `/record/v1/${recordType}`, {
        query: { limit: 1 }
      });
      return true;
    } catch (error) {
      if (
        error instanceof NetSuiteError &&
        (error.kind === "not-found" || error.kind === "auth")
      ) {
        return false;
      }
      throw error;
    }
  }
}
