// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Accounting sync against a live local database when an attempt dies or its
// response is lost: the real drain, consolidation and reconcile code, with the
// provider faked at the network.
//   SUPABASE_DB_URL=… pnpm --filter @carbon/jobs exec vitest run accounting-sync-retries
//
// The fake Xero keeps the documents it created, so a second create is visible,
// and honours an `Idempotency-Key` for six minutes, as Xero does. Its clock
// moves only when a test moves it: a Retry or a stale reclaim comes ten or
// more minutes after the first attempt, past that window. The fake QuickBooks
// keeps its customers and answers a repeated `requestid` with the first
// create's response, as Intuit does. Ledger rows go
// through the local PostgREST, as in production, so each test commits its rows
// under a company of its own and the suite deletes them afterwards.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "@carbon/database";
import {
  getPostgresClient,
  type Kysely,
  type KyselyDatabase
} from "@carbon/database/client";
import {
  enqueueSyncOperation,
  getProviderIntegration,
  getSyncOperationsByIds,
  ProviderID,
  type QboProvider,
  type SyncOperation,
  transitionOperation,
  type XeroProvider
} from "@carbon/ee/accounting";
import { buildIntegrationTopology } from "@carbon/ee/sync";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PostgresDriver, sql } from "kysely";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { drainSyncOperations } from "./accounting-sync-operations";
import { reconcileEntities } from "./reconcile-executor";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

function localEnv(): Record<string, string> {
  const file = [".env.local", "../../.env.local"]
    .map((path) => join(process.cwd(), path))
    .find((path) => existsSync(path));
  const env: Record<string, string> = {};
  if (!file) return env;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (match?.[1] && match[2] !== undefined) env[match[1]] = match[2].trim();
  }
  return env;
}

const env = localEnv();
const hasLocalStack = (() => {
  try {
    return (
      LOCAL_HOSTS.includes(
        new URL(process.env.SUPABASE_DB_URL ?? "").hostname
      ) &&
      !!env.PORT_API &&
      !!env.SUPABASE_SERVICE_ROLE_KEY
    );
  } catch {
    return false;
  }
})();

const realFetch = globalThis.fetch;
const MINUTE = 60_000;
/** Xero keeps an Idempotency-Key for six minutes. */
const XERO_KEY_WINDOW_MS = 6 * MINUTE;

type Fate = "deliver" | "lose" | "hold";
type Json = Record<string, unknown>;

/** Xero's `where` as Carbon writes it: `Field=="value"` clauses joined by one AND or OR. */
function matchesWhere(document: Json, where: string | null): boolean {
  if (!where) return true;
  const joiner = where.includes(" OR ") ? " OR " : " AND ";
  const clauses = where.split(joiner).map((clause) => {
    const match = clause.trim().match(/^(\w+)==(".*")$/);
    if (!match?.[1] || !match[2]) throw new Error(`fake Xero: where ${clause}`);
    return document[match[1]] === JSON.parse(match[2]);
  });
  return joiner === " OR " ? clauses.some(Boolean) : clauses.every(Boolean);
}

/**
 * Xero at the HTTP boundary: manual journals and contacts it stores, the
 * Idempotency-Key replay, and a fate for the next create's response.
 */
class FakeXero {
  now = 0;
  journals: Json[] = [];
  contacts: Json[] = [];
  private keys = new Map<string, { at: number; body: Json }>();
  private fates: Fate[] = [];
  private held: Array<(status: number) => void> = [];
  private heldWaiters: Array<() => void> = [];
  private sequence = 0;

  /** The fate of the next create; later creates are delivered. */
  next(...fates: Fate[]) {
    this.fates.push(...fates);
  }

  /** Resolves once a create's response is being held. */
  async heldCreate(): Promise<void> {
    if (this.held.length > 0) return;
    await new Promise<void>((resolve) => this.heldWaiters.push(resolve));
  }

  /** Answer the held create with this status. */
  release(status: number) {
    const answer = this.held.shift();
    if (!answer) throw new Error("fake Xero: no held create");
    answer(status);
  }

  async handle(url: URL, init: RequestInit): Promise<Response> {
    const method = (init.method ?? "GET").toUpperCase();
    const path = url.pathname.replace("/api.xro/2.0", "");
    const where = url.searchParams.get("where");
    if (method === "GET" && path === "/Organisation") {
      return json({ Organisations: [{ Name: "Fake" }] });
    }
    if (method === "GET" && path === "/ManualJournals") {
      return json({
        ManualJournals: this.journals.filter((j) => matchesWhere(j, where))
      });
    }
    if (method === "GET" && path === "/Contacts") {
      return json({
        Contacts: this.contacts.filter((c) => matchesWhere(c, where))
      });
    }
    if ((method === "POST" || method === "PUT") && path === "/ManualJournals") {
      const [journal] = (JSON.parse(String(init.body)) as Json)
        .ManualJournals as Json[];
      return this.write(
        "ManualJournals",
        "ManualJournalID",
        this.journals,
        journal!,
        init
      );
    }
    if (method === "POST" && path === "/Contacts") {
      const [contact] = (JSON.parse(String(init.body)) as Json)
        .Contacts as Json[];
      return this.write("Contacts", "ContactID", this.contacts, contact!, init);
    }
    throw new Error(`fake Xero: ${method} ${path}`);
  }

  private async write(
    envelope: string,
    idField: string,
    store: Json[],
    document: Json,
    init: RequestInit
  ): Promise<Response> {
    const key = (init.headers as Record<string, string> | undefined)?.[
      "Idempotency-Key"
    ];
    const replay = key ? this.keys.get(key) : undefined;
    if (replay && this.now - replay.at < XERO_KEY_WINDOW_MS) {
      return json(replay.body);
    }

    let stored: Json;
    const existing = document[idField]
      ? store.find((row) => row[idField] === document[idField])
      : undefined;
    if (existing) {
      Object.assign(existing, document);
      stored = existing;
    } else {
      stored = { ...document, [idField]: `${envelope}-${++this.sequence}` };
      store.push(stored);
    }
    const body = { [envelope]: [stored] };
    if (key) this.keys.set(key, { at: this.now, body });

    const fate = existing ? "deliver" : (this.fates.shift() ?? "deliver");
    if (fate === "lose") return json({ Message: "Gateway Timeout" }, 504);
    if (fate === "hold") {
      const status = await new Promise<number>((resolve) => {
        this.held.push(resolve);
        for (const wake of this.heldWaiters.splice(0)) wake();
      });
      return status === 200 ? json(body) : json({ Message: "Error" }, status);
    }
    return json(body);
  }
}

/**
 * QuickBooks Online at the HTTP boundary: the customers it stores, the
 * `requestid` replay (Intuit answers a repeated requestid with the original
 * create's response) and a fate for the next create's response.
 */
class FakeQuickBooks {
  customers: Json[] = [];
  private replies = new Map<string, Json>();
  private fates: Fate[] = [];
  private sequence = 0;

  /** The fate of the next create; later creates are delivered. */
  next(...fates: Fate[]) {
    this.fates.push(...fates);
  }

  async handle(url: URL, init: RequestInit): Promise<Response> {
    const method = (init.method ?? "GET").toUpperCase();
    const path = url.pathname.replace(/^\/v3\/company\/[^/]+/, "");
    if (method === "GET" && path === "/query") {
      const statement = url.searchParams.get("query") ?? "";
      const match = statement.match(
        /^SELECT \* FROM Customer(?: WHERE DisplayName = '((?:[^'\\]|\\.)*)')? STARTPOSITION/
      );
      if (!match) throw new Error(`fake QuickBooks: query ${statement}`);
      const name = match[1]?.replace(/\\'/g, "'");
      return json({
        QueryResponse: {
          Customer: this.customers.filter(
            (customer) => name === undefined || customer.DisplayName === name
          )
        }
      });
    }
    const read = path.match(/^\/customer\/([^/]+)$/);
    if (method === "GET" && read) {
      const customer = this.customers.find((c) => c.Id === read[1]);
      return customer
        ? json({ Customer: customer })
        : json({ Fault: { Error: [{ Message: "Object Not Found" }] } }, 400);
    }
    if (method === "POST" && path === "/customer") {
      const body = JSON.parse(String(init.body)) as Json;
      if (body.Id) {
        const existing = this.customers.find((c) => c.Id === body.Id);
        if (!existing)
          throw new Error("fake QuickBooks: update of no customer");
        Object.assign(existing, body, {
          SyncToken: String(Number(existing.SyncToken) + 1)
        });
        return json({ Customer: existing });
      }
      const requestId = url.searchParams.get("requestid");
      const replay = requestId ? this.replies.get(requestId) : undefined;
      if (replay) return json(replay);
      const created: Json = {
        ...body,
        Id: String(++this.sequence),
        SyncToken: "0",
        MetaData: { LastUpdatedTime: "2026-11-02T00:00:00Z" }
      };
      this.customers.push(created);
      const reply = { Customer: { ...created } };
      if (requestId) this.replies.set(requestId, reply);
      if ((this.fates.shift() ?? "deliver") === "lose") {
        return json(
          { Fault: { Error: [{ Message: "Gateway Timeout" }] } },
          504
        );
      }
      return json(reply);
    }
    throw new Error(`fake QuickBooks: ${method} ${path}`);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe.skipIf(!hasLocalStack)("accounting sync retries (Postgres)", () => {
  const pool = new Pool({
    connectionString: process.env.SUPABASE_DB_URL,
    max: 2
  });
  const db: Kysely<KyselyDatabase> = getPostgresClient<KyselyDatabase>(
    pool,
    PostgresDriver
  );
  // Built in beforeAll: a skipped suite still runs this body, and with no
  // local stack the URL is malformed.
  let client: SupabaseClient<Database>;
  const companies: string[] = [];
  let fake: FakeXero;
  let quickBooks: FakeQuickBooks;
  let consolidateIntegration: typeof import("./accounting-consolidation")["consolidateIntegration"];

  beforeAll(async () => {
    client = createClient<Database>(
      `http://localhost:${env.PORT_API}`,
      env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { fetch: realFetch }
      }
    );
    // The consolidation module builds its service-role and Redis clients at
    // import, from the local stack's environment.
    process.env.SUPABASE_URL ??= `http://localhost:${env.PORT_API}`;
    for (const [name, value] of Object.entries(env))
      process.env[name] ??= value;
    ({ consolidateIntegration } = await import("./accounting-consolidation"));
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.hostname === "api.xero.com") return fake.handle(url, init ?? {});
      if (url.hostname === "quickbooks.api.intuit.com") {
        return quickBooks.handle(url, init ?? {});
      }
      return realFetch(input, init);
    });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    for (const companyId of companies) {
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL session_replication_role = replica`.execute(trx);
        for (const table of [
          "accountingSyncOperation",
          "externalIntegrationMapping",
          "journalLine",
          "journal",
          "customer",
          "companyIntegration"
        ] as const) {
          await trx
            .deleteFrom(table)
            .where("companyId", "=", companyId)
            .execute();
        }
        const company = await trx
          .selectFrom("company")
          .select("companyGroupId")
          .where("id", "=", companyId)
          .executeTakeFirst();
        await trx.deleteFrom("company").where("id", "=", companyId).execute();
        if (company?.companyGroupId) {
          await trx
            .deleteFrom("account")
            .where("companyGroupId", "=", company.companyGroupId)
            .execute();
          await trx
            .deleteFrom("companyGroup")
            .where("id", "=", company.companyGroupId)
            .execute();
        }
      });
    }
    await db.destroy();
  });

  /**
   * A Xero-connected company with two mapped balance-sheet accounts and one
   * posted journal between them. `postingSync` is stored as given.
   */
  async function company(postingSync?: Json) {
    fake = new FakeXero();
    const prefix = `syncretry-${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const companyId = `${prefix}-company`;
    const groupId = `${prefix}-group`;
    companies.push(companyId);
    const metadata = {
      credentials: {
        type: "oauth2",
        accessToken: "fake-access",
        refreshToken: "fake-refresh",
        providerMetadata: { tenantId: "fake-tenant" }
      },
      ...(postingSync ? { settings: { postingSync } } : {})
    };
    await db.transaction().execute(async (trx) => {
      await sql`SET LOCAL session_replication_role = replica`.execute(trx);
      await trx
        .insertInto("companyGroup")
        .values({ id: groupId, name: prefix, createdBy: "system" })
        .execute();
      await trx
        .insertInto("company")
        .values({
          id: companyId,
          name: prefix,
          companyGroupId: groupId,
          baseCurrencyCode: "USD"
        })
        .execute();
      await trx
        .insertInto("account")
        .values(
          (["Asset", "Liability"] as const).map((accountClass) => ({
            id: `${prefix}-${accountClass}`,
            name: accountClass,
            class: accountClass,
            incomeBalance: "Balance Sheet" as const,
            companyGroupId: groupId,
            createdBy: "system"
          }))
        )
        .execute();
      await trx
        .insertInto("externalIntegrationMapping")
        .values(
          (["Asset", "Liability"] as const).map((accountClass, i) => ({
            entityType: "account",
            entityId: `${prefix}-${accountClass}`,
            integration: "xero",
            externalId: `xero-account-${i}`,
            metadata: JSON.stringify({ externalCode: `${i + 1}00` }),
            companyId
          }))
        )
        .execute();
      await trx
        .insertInto("companyIntegration")
        .values({
          id: "xero",
          companyId,
          active: true,
          metadata: JSON.stringify(metadata)
        })
        .execute();
    });
    const provider = getProviderIntegration(
      client,
      companyId,
      ProviderID.XERO,
      metadata as never
    ) as XeroProvider;
    return { companyId, prefix, provider, metadata, integration: "xero" };
  }

  /** A QuickBooks-connected company, with nothing mapped. */
  async function quickBooksCompany() {
    quickBooks = new FakeQuickBooks();
    const prefix = `syncretry-${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const companyId = `${prefix}-company`;
    const groupId = `${prefix}-group`;
    companies.push(companyId);
    const metadata = {
      credentials: {
        type: "oauth2",
        accessToken: "fake-access",
        refreshToken: "fake-refresh",
        providerMetadata: { realmId: "fake-realm" }
      }
    };
    await db.transaction().execute(async (trx) => {
      await sql`SET LOCAL session_replication_role = replica`.execute(trx);
      await trx
        .insertInto("companyGroup")
        .values({ id: groupId, name: prefix, createdBy: "system" })
        .execute();
      await trx
        .insertInto("company")
        .values({
          id: companyId,
          name: prefix,
          companyGroupId: groupId,
          baseCurrencyCode: "USD"
        })
        .execute();
      await trx
        .insertInto("companyIntegration")
        .values({
          id: "quickbooks",
          companyId,
          active: true,
          metadata: JSON.stringify(metadata)
        })
        .execute();
    });
    const provider = getProviderIntegration(
      client,
      companyId,
      ProviderID.QUICKBOOKS,
      metadata as never
    ) as QboProvider;
    return { companyId, prefix, provider, metadata, integration: "quickbooks" };
  }

  async function postedJournal(
    scope: { companyId: string; prefix: string },
    name: string
  ) {
    const id = `${scope.prefix}-${name}`;
    await db.transaction().execute(async (trx) => {
      await sql`SET LOCAL session_replication_role = replica`.execute(trx);
      await trx
        .insertInto("journal")
        .values({
          id,
          journalEntryId: `JE-${name}`,
          companyId: scope.companyId,
          postingDate: "2026-11-02",
          status: "Posted",
          sourceType: "Transfer Receipt"
        })
        .execute();
      await trx
        .insertInto("journalLine")
        .values(
          (["Asset", "Liability"] as const).map((accountClass, i) => ({
            journalId: id,
            accountId: `${scope.prefix}-${accountClass}`,
            amount: 100,
            journalLineReference: `${name}-${i}`,
            companyId: scope.companyId
          }))
        )
        .execute();
    });
    return id;
  }

  async function enqueue(
    companyId: string,
    entityType: string,
    entityId: string,
    metadata?: Json,
    integration = "xero"
  ): Promise<SyncOperation> {
    const result = await enqueueSyncOperation(client, {
      companyId,
      integration,
      entityType,
      entityId,
      direction: "push-to-accounting",
      trigger: "posting",
      idempotencyKey: `${entityType}:${entityId}:${crypto.randomUUID()}`,
      createdBy: "system",
      ...(metadata ? { metadata } : {})
    });
    if (!result.data) throw new Error(result.error ?? "enqueue skipped");
    return result.data;
  }

  async function operation(companyId: string, id: string) {
    const { data } = await getSyncOperationsByIds(client, {
      companyId,
      ids: [id]
    });
    return data[0]!;
  }

  /** The attempt was abandoned this long ago: what a stale reclaim sees. */
  async function age(companyId: string, minutes: number) {
    await db
      .updateTable("accountingSyncOperation")
      .set({
        lastAttemptAt: sql`"lastAttemptAt" - make_interval(mins => ${minutes})`
      })
      .where("companyId", "=", companyId)
      .where("status", "=", "In Flight")
      .execute();
    fake.now += minutes * MINUTE;
  }

  function drain(scope: {
    companyId: string;
    provider: XeroProvider | QboProvider;
    metadata: unknown;
    integration: string;
  }) {
    return drainSyncOperations({
      client,
      database: db,
      companyId: scope.companyId,
      integration: scope.integration,
      provider: scope.provider,
      integrationMetadata: scope.metadata
    });
  }

  it("a journal whose create response was lost is created once when its operation is retried", async () => {
    const scope = await company();
    const journalId = await postedJournal(scope, "lost");
    const op = await enqueue(scope.companyId, "journalEntry", journalId);

    fake.next("lose");
    await drain(scope);
    expect((await operation(scope.companyId, op.id)).status).toBe("Failed");

    fake.now += 10 * MINUTE;
    await transitionOperation(client, {
      id: op.id,
      companyId: scope.companyId,
      to: "Pending",
      userId: "system"
    });
    await drain(scope);

    expect(fake.journals.map((j) => j.ManualJournalID)).toEqual([
      "ManualJournals-1"
    ]);
    expect(await operation(scope.companyId, op.id)).toMatchObject({
      status: "Completed",
      externalId: "ManualJournals-1"
    });
  });

  /**
   * Attempt 1's create reaches Xero and its response is held; the row goes
   * stale, attempt 2 reclaims and finishes it; then attempt 1's response
   * arrives as a 500.
   */
  async function staleReclaim(name: string) {
    const scope = await company();
    const journalId = await postedJournal(scope, name);
    const op = await enqueue(scope.companyId, "journalEntry", journalId);

    fake.next("hold");
    const first = drain(scope);
    await fake.heldCreate();

    await age(scope.companyId, 11);
    await drain(scope);
    fake.release(500);
    await first;
    return operation(scope.companyId, op.id);
  }

  it("a stale reclaim of a journal still being pushed creates it once", async () => {
    await staleReclaim("stale-create");
    expect(fake.journals.map((j) => j.ManualJournalID)).toEqual([
      "ManualJournals-1"
    ]);
  });

  it("a reclaimed attempt's late failure does not reopen the operation the newer attempt completed", async () => {
    expect(await staleReclaim("stale-close")).toMatchObject({
      status: "Completed",
      attemptCount: 2
    });
  });

  it("an edit made while a customer's push is in flight is pushed afterwards", async () => {
    const scope = await company();
    const customerId = `${scope.prefix}-customer`;
    await db
      .insertInto("customer")
      .values({
        id: customerId,
        name: "Before",
        companyId: scope.companyId,
        updatedAt: sql<string>`now() - interval '1 hour'`
      })
      .execute();
    await enqueue(scope.companyId, "customer", customerId);

    fake.next("hold");
    const push = drain(scope);
    await fake.heldCreate();
    await db
      .updateTable("customer")
      .set({ name: "After", updatedAt: sql<string>`now()` })
      .where("id", "=", customerId)
      .execute();
    fake.release(200);
    await push;

    const reconciled = await reconcileEntities({
      client,
      database: db,
      companyId: scope.companyId,
      providerId: "xero",
      integrationMetadata: scope.metadata,
      topology: buildIntegrationTopology([], []),
      createdBy: "system",
      scope: crypto.randomUUID(),
      refs: [{ entityType: "customer", entityId: customerId }]
    });
    expect(reconciled.enqueued).toBe(1);

    await drain(scope);
    expect(fake.contacts.map((c) => c.Name)).toEqual(["After"]);
  });

  // QuickBooks keys a create by its requestid. A customer created under the
  // same key as before the rename was answered with the first create's
  // replayed response, the old name, and linked as the renamed version.
  it("a QuickBooks customer renamed after a create whose response was lost is pushed with its new name", async () => {
    const scope = await quickBooksCompany();
    const customerId = `${scope.prefix}-customer`;
    await db
      .insertInto("customer")
      .values({
        id: customerId,
        name: "Before",
        companyId: scope.companyId,
        updatedAt: sql<string>`now() - interval '1 hour'`
      })
      .execute();
    const op = await enqueue(
      scope.companyId,
      "customer",
      customerId,
      undefined,
      "quickbooks"
    );

    quickBooks.next("lose");
    await drain(scope);
    expect((await operation(scope.companyId, op.id)).status).toBe("Failed");
    // The create reached QuickBooks; only its response was lost.
    expect(quickBooks.customers.map((c) => c.DisplayName)).toEqual(["Before"]);

    await db
      .updateTable("customer")
      .set({ name: "After", updatedAt: sql<string>`now()` })
      .where("id", "=", customerId)
      .execute();
    await transitionOperation(client, {
      id: op.id,
      companyId: scope.companyId,
      to: "Pending",
      userId: "system"
    });
    await drain(scope);
    // Whatever the retry linked, a reconcile pushes an edit it did not.
    await reconcileEntities({
      client,
      database: db,
      companyId: scope.companyId,
      providerId: "quickbooks",
      integrationMetadata: scope.metadata,
      topology: buildIntegrationTopology([], []),
      createdBy: "system",
      scope: crypto.randomUUID(),
      refs: [{ entityType: "customer", entityId: customerId }]
    });
    await drain(scope);

    const mapping = await db
      .selectFrom("externalIntegrationMapping")
      .select("externalId")
      .where("companyId", "=", scope.companyId)
      .where("integration", "=", "quickbooks")
      .where("entityType", "=", "customer")
      .where("entityId", "=", customerId)
      .executeTakeFirstOrThrow();
    expect(
      quickBooks.customers.find((c) => c.Id === mapping.externalId)?.DisplayName
    ).toBe("After");
  });

  it("a consolidation that died after creating the day's summary journal does not create a second one", async () => {
    const scope = await company({
      sourceTypes: {
        "Transfer Receipt": { enabled: true, granularity: "daily-summary" }
      }
    });
    const members = [
      await postedJournal(scope, "day-1"),
      await postedJournal(scope, "day-2")
    ];
    const ops = [];
    for (const journalId of members) {
      ops.push(
        await enqueue(scope.companyId, "journalEntry", journalId, {
          granularity: "daily-summary"
        })
      );
    }
    const consolidate = () =>
      consolidateIntegration({
        client,
        database: db,
        companyId: scope.companyId,
        providerId: ProviderID.XERO,
        integrationMetadata: scope.metadata,
        provider: scope.provider,
        createdBy: "system"
      });

    fake.next("hold");
    const died = consolidate();
    await fake.heldCreate();

    await age(scope.companyId, 24 * 60);
    await consolidate();
    fake.release(500);
    await died;

    expect(fake.journals.map((j) => j.ManualJournalID)).toEqual([
      "ManualJournals-1"
    ]);
    for (const op of ops) {
      expect(await operation(scope.companyId, op.id)).toMatchObject({
        status: "Completed",
        externalId: "ManualJournals-1"
      });
    }
  });
});
