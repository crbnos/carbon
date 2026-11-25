// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import { type FakeDatabase, fakeDatabase } from "./fake-database-test-fixture";
import {
  BaseEntitySyncer,
  getPushedVersion,
  type RemoteUpsertOutcome,
  type SyncContext
} from "./types";
import { RatelimitError } from "./utils";

describe("getPushedVersion", () => {
  // The forms an `updatedAt` reaches a syncer in: PostgREST's ISO text, a
  // Postgres text cast, and the JS Date the pg driver decodes a timestamptz to.
  it.each([
    ["2026-11-25T10:00:00.123456+00:00", "2026-11-25T10:00:00.123Z"],
    ["2026-11-25 10:00:00.123456+00", "2026-11-25T10:00:00.123Z"],
    ["2026-11-25 15:30:00+05:30", "2026-11-25T10:00:00.000Z"],
    ["2026-11-25T10:00:00Z", "2026-11-25T10:00:00.000Z"]
  ])("reads the instant of the timestamp %s", (updatedAt, version) => {
    expect(getPushedVersion({ updatedAt })).toBe(version);
  });

  it("reads the instant of a decoded Date", () => {
    expect(
      getPushedVersion({ updatedAt: new Date(Date.UTC(2026, 10, 25, 10)) })
    ).toBe("2026-11-25T10:00:00.000Z");
  });

  it.each([
    undefined,
    null,
    {},
    { updatedAt: null },
    { updatedAt: "" },
    { updatedAt: "yesterday" },
    { updatedAt: new Date(Number.NaN) }
  ])("has no version for %o, so the link stamps the link time", (entity) => {
    expect(getPushedVersion(entity)).toBeUndefined();
  });
});

type Local = { id: string; updatedAt: string };
type Remote = { id: string };

/**
 * The base push path with a provider that answers from `answer`: a remote
 * id, or a thrown error, per document. Writes land in the fake database.
 */
class TestSyncer extends BaseEntitySyncer<Local, Remote, never> {
  answer: (localId: string) => string = (localId) => `remote-${localId}`;
  /** What `mayExistRemotely` said for each create. */
  lookedUp = new Map<string, boolean>();

  protected async fetchLocal(id: string) {
    return { id, updatedAt: "2026-11-25T10:00:00.000Z" };
  }
  protected async fetchLocalBatch(ids: string[]) {
    return new Map(
      ids.map((id) => [id, { id, updatedAt: "2026-11-25T10:00:00.000Z" }])
    );
  }
  protected async mapToRemote(local: Local) {
    return { id: local.id };
  }
  protected async upsertRemote(_: Remote, localId: string) {
    this.lookedUp.set(localId, this.mayExistRemotely(localId));
    return this.answer(localId);
  }
  protected async upsertRemoteBatch(
    data: Array<{ localId: string; payload: Remote }>
  ): Promise<Map<string, RemoteUpsertOutcome>> {
    return this.upsertRemoteEach(data);
  }
  protected async fetchRemote() {
    return null;
  }
  protected async fetchRemoteBatch() {
    return new Map();
  }
  protected async mapToLocal() {
    return {};
  }
  protected getRemoteUpdatedAt() {
    return null;
  }
  protected async upsertLocal(): Promise<string> {
    throw new Error("push only");
  }
}

function syncer(db: FakeDatabase, context: Partial<SyncContext> = {}) {
  return new TestSyncer({
    database: db.database,
    companyId: "company-1",
    provider: { id: "xero" } as never,
    config: { enabled: true, direction: "push-to-accounting", owner: "carbon" },
    entityType: "bill",
    ...context
  });
}

const mappedIds = (db: FakeDatabase) =>
  db.rows("externalIntegrationMapping").map((row) => row.entityId);

describe("BaseEntitySyncer.pushBatchToAccounting", () => {
  // A success closes its operation Completed: without its mapping, the next
  // attempt finds no link and creates the document again.
  it("reports no success for a document whose mapping was not saved", async () => {
    const db = fakeDatabase();
    db.failNextWrite(
      "externalIntegrationMapping",
      new Error("connection reset")
    );

    const result = await syncer(db).pushBatchToAccounting(["a", "b"]);

    expect(result.results).toEqual([
      {
        status: "error",
        action: "none",
        localId: "a",
        error: "connection reset"
      },
      {
        status: "error",
        action: "none",
        localId: "b",
        error: "connection reset"
      }
    ]);
    expect(mappedIds(db)).toEqual([]);
  });

  it("links the documents created before a rate limit, then hands the rate limit to the caller", async () => {
    const db = fakeDatabase();
    const push = syncer(db);
    push.answer = (localId) => {
      if (localId === "b") {
        throw new RatelimitError("Rate limit exceeded", {
          retryAfterSeconds: 30
        } as never);
      }
      return `remote-${localId}`;
    };

    await expect(
      push.pushBatchToAccounting(["a", "b", "c"])
    ).rejects.toBeInstanceOf(RatelimitError);
    expect(mappedIds(db)).toEqual(["a"]);
    expect([...push.lookedUp.keys()]).toEqual(["a", "b"]);
  });

  it("keeps one document's refusal its own and links the others", async () => {
    const db = fakeDatabase();
    const push = syncer(db);
    push.answer = (localId) => {
      if (localId === "b") throw new Error("Account code is not valid");
      return `remote-${localId}`;
    };

    const result = await push.pushBatchToAccounting(["a", "b", "c"]);

    expect(
      result.results.map(({ localId, status }) => [localId, status])
    ).toEqual([
      ["b", "error"],
      ["a", "success"],
      ["c", "success"]
    ]);
    expect(mappedIds(db)).toEqual(["a", "c"]);
  });
});

describe("mayExistRemotely", () => {
  it("trusts the attempted set only for the entity type it was built for", async () => {
    const attempted = { entityType: "bill" as const, ids: new Set(["a"]) };
    const bills = syncer(fakeDatabase(), { attempted });
    // A dependency of another type built from a spread of the bill context.
    const invoices = syncer(fakeDatabase(), {
      attempted,
      entityType: "invoice"
    });

    await bills.pushBatchToAccounting(["a", "b"]);
    await invoices.pushBatchToAccounting(["a", "b"]);

    expect([...bills.lookedUp]).toEqual([
      ["a", true],
      ["b", false]
    ]);
    expect([...invoices.lookedUp]).toEqual([
      ["a", true],
      ["b", true]
    ]);
  });
});
