// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database and PostgREST; skipped without them.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { expect, vi } from "vitest";
import { scanKanban } from "../../app/modules/inventory/inventory.server";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER,
  workCenterFixture
} from "./fixtures/always-post";
import { databaseTest, hasLocalDatabase } from "./fixtures/local-database";
import { localServiceRoleClient } from "./fixtures/local-supabase";

// Get Method is a posting, and the posting gate tells the system by its key.
vi.mock("@carbon/env", async (importOriginal) => {
  const { localServiceRoleKey } = await import("./fixtures/local-supabase");
  return {
    ...(await importOriginal<object>()),
    SUPABASE_SERVICE_ROLE_KEY: localServiceRoleKey() ?? "test"
  };
});

const client = hasLocalDatabase ? localServiceRoleClient() : null;
const scanTest = (name: string, fn: () => Promise<void>) =>
  databaseTest(name, async () => {
    if (!client) return;
    await fn();
  });

function context(f: Fixture) {
  return createServiceContext({
    actor: { type: "system", onBehalfOf: USER },
    company: { id: f.companyId, groupId: f.groupId },
    caller: client as never,
    system: () => client as never,
    pg: () => f.db,
    kv: () => {
      throw new Error("The scan uses no kv");
    }
  });
}

/** An auto-release Make kanban under strict backflush. Its BoM line has a
 *  Pull From only when `pullFrom`. */
async function strictKanban(f: Fixture, { pullFrom }: { pullFrom: boolean }) {
  const kanbanId = `${f.prefix}-kanban`;
  const workCenterId = await workCenterFixture(f);
  await seed(f, async (trx) => {
    await trx
      .insertInto("sequence")
      .values({
        table: "job",
        name: "Job",
        prefix: "J",
        next: 0,
        size: 6,
        step: 1,
        companyId: f.companyId
      })
      .execute();
    const shelf = await trx
      .insertInto("storageUnit")
      .values({
        name: "Shelf A",
        locationId: f.locationId,
        companyId: f.companyId,
        createdBy: USER
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const process = await trx
      .insertInto("process")
      .values({
        name: "Assemble",
        defaultStandardFactor: "Hours/Piece",
        companyId: f.companyId,
        createdBy: USER
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const method = await trx
      .insertInto("makeMethod")
      .values({
        itemId: f.assemblyId,
        version: 99,
        companyId: f.companyId,
        createdBy: USER
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("methodOperation")
      .values({
        makeMethodId: method.id,
        processId: process.id,
        workCenterId,
        description: "Assemble",
        laborTime: 1,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("methodMaterial")
      .values({
        makeMethodId: method.id,
        itemId: f.partId,
        itemType: "Part",
        methodType: "Pull from Inventory",
        quantity: 2,
        unitOfMeasureCode: "EA",
        storageUnitIds: pullFrom ? { [f.locationId]: shelf.id } : {},
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("kanban")
      .values({
        id: kanbanId,
        itemId: f.assemblyId,
        replenishmentSystem: "Make",
        quantity: 5,
        locationId: f.locationId,
        purchaseUnitOfMeasureCode: "EA",
        autoRelease: true,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .updateTable("companySettings")
      .set({ requireBackflushStorageUnit: true })
      .where("id", "=", f.companyId)
      .execute();
  });
  return kanbanId;
}

const messageOf = (scan: Awaited<ReturnType<typeof scanKanban>>) =>
  scan.data?.type === "job" ? scan.data.message : undefined;

async function kanbanJob(f: Fixture, kanbanId: string) {
  const kanban = await f.db
    .selectFrom("kanban")
    .select("jobId")
    .where("id", "=", kanbanId)
    .executeTakeFirstOrThrow();
  return f.db
    .selectFrom("job")
    .select(["id", "jobId", "status"])
    .where("id", "=", kanban.jobId!)
    .executeTakeFirstOrThrow();
}

scanTest(
  "a kanban job that fails the release checks stays Draft and says why",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const kanbanId = await strictKanban(f, { pullFrom: false });

      const scan = await scanKanban(context(f), { kanbanId });

      expect(scan.error).toBeNull();
      const job = await kanbanJob(f, kanbanId);
      expect(job.status).toBe("Draft");
      expect(scan.data).toMatchObject({
        type: "job",
        jobId: job.id,
        operationId: null
      });
      expect(messageOf(scan)).toBe(
        `${job.jobId} was created but not released: set a Pull From storage unit on ${f.prefix}-PART`
      );
    } finally {
      await f.cleanup();
    }
  }
);

scanTest("a kanban job that passes the release checks is released", async () => {
  const f = await alwaysPostFixture();
  try {
    const kanbanId = await strictKanban(f, { pullFrom: true });

    const scan = await scanKanban(context(f), { kanbanId });

    expect(scan.error).toBeNull();
    expect(messageOf(scan)).toBeNull();
    const job = await kanbanJob(f, kanbanId);
    expect(job.status).toBe("Ready");
    expect(scan.data).toMatchObject({ operationId: expect.any(String) });
  } finally {
    await f.cleanup();
  }
});

scanTest(
  "a kanban job whose method could not be copied stays Draft and says so",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const kanbanId = await strictKanban(f, { pullFrom: true });
      await f.db
        .deleteFrom("makeMethod")
        .where("itemId", "=", f.assemblyId)
        .where("companyId", "=", f.companyId)
        .execute();

      const scan = await scanKanban(context(f), { kanbanId });

      expect(scan.error).toBeNull();
      const job = await kanbanJob(f, kanbanId);
      expect(job.status).toBe("Draft");
      expect(messageOf(scan)).toBe(
        `${job.jobId} was created, but its method could not be copied. Use Get Method on the job before releasing it.`
      );
    } finally {
      await f.cleanup();
    }
  }
);
