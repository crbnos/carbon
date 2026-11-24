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
// more minutes after the first attempt, past that window. Ledger rows go
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
  type SyncOperation,
  type XeroProvider
} from "@carbon/ee/accounting";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PostgresDriver, sql } from "kysely";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { drainSyncOperations } from "./accounting-sync-operations";

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
  const client: SupabaseClient<Database> = createClient<Database>(
    `http://localhost:${env.PORT_API}`,
    env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: realFetch }
    }
  );
  const companies: string[] = [];
  let fake: FakeXero;

  beforeAll(async () => {
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      return url.hostname === "api.xero.com"
        ? fake.handle(url, init ?? {})
        : realFetch(input, init);
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
    return { companyId, prefix, provider, metadata };
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
    metadata?: Json
  ): Promise<SyncOperation> {
    const result = await enqueueSyncOperation(client, {
      companyId,
      integration: "xero",
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
    provider: XeroProvider;
    metadata: unknown;
  }) {
    return drainSyncOperations({
      client,
      database: db,
      companyId: scope.companyId,
      integration: "xero",
      provider: scope.provider,
      integrationMetadata: scope.metadata
    });
  }

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

  it("a reclaimed attempt's late failure does not reopen the operation the newer attempt completed", async () => {
    expect(await staleReclaim("stale-close")).toMatchObject({
      status: "Completed",
      attemptCount: 2
    });
  });
});
