// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import {
  issueMaterial,
  postInventoryAdjustment
} from "../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import { alwaysPostFixture, type Fixture, USER } from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import {
  connectLocalTestDatabase,
  databaseTest
} from "./fixtures/local-database";
import { confirmPackoutCommand, createPairedJob } from "./fixtures/paired-job";
import { receiveProductionPair } from "./fixtures/packout-production";

type Job = Awaited<ReturnType<typeof createPairedJob>>;

async function issue(
  f: Fixture,
  job: Job,
  sourceId: string,
  outputId = job.unitId,
  issueId?: string
) {
  return invokePosting(
    handlesOf(f.ctx),
    "issue",
    await confirmPackoutCommand(f, {
      type: "trackedEntitiesToOperation",
      materialId: job.materialId,
      jobOperationId: job.operationId,
      parentTrackedEntityId: outputId,
      children: [{ trackedEntityId: sourceId, quantity: 1 }],
      issueId,
      allowOverIssue: true
    }),
    issueMaterial
  );
}
async function complete(f: Fixture, job: Job) {
  return invokePosting(
    handlesOf(f.ctx),
    "issue",
    await confirmPackoutCommand(f, {
      type: "jobOperationSerialComplete",
      jobOperationId: job.operationId,
      trackedEntityId: job.unitId,
      quantity: 1
    }),
    issueMaterial
  );
}

databaseTest(
  "a scan binds one exact source to the selected piece of a multi-piece job",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const production = await receiveProductionPair(f);
      const job = await createPairedJob(f, production.productionItemId);
      const wrong = await f.db
        .insertInto("trackedEntity")
        .values({
          itemId: f.partId,
          sourceDocument: "Item",
          sourceDocumentId: f.partId,
          readableId: "OTHER",
          quantity: 1,
          status: "Available",
          companyId: f.companyId,
          createdBy: USER
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      expect((await issue(f, job, wrong.id!)).error).toBeTruthy();
      const changeSource = () =>
        f.db
          .updateTable("trackedEntity")
          .where("companyId", "=", f.companyId)
          .where("id", "=", production.first.id!);
      const rejectSource = async () =>
        expect((await issue(f, job, production.first.id!)).error).toBeTruthy();
      await changeSource().set({ readableId: "   " }).execute();
      await rejectSource();
      await changeSource()
        .set({ readableId: production.first.serial, quantity: 2 })
        .execute();
      await rejectSource();
      await changeSource().set({ quantity: 1, status: "On Hold" }).execute();
      await rejectSource();
      const original = await f.db
        .selectFrom("trackedEntity")
        .select("attributes")
        .where("id", "=", production.first.id!)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      await changeSource()
        .set({
          status: "Available",
          attributes: {
            ...(original.attributes as Record<string, string>),
            Shipment: "draft"
          }
        })
        .execute();
      await rejectSource();
      await changeSource().set({ attributes: original.attributes }).execute();

      const scan = crypto.randomUUID();
      expect(
        (await issue(f, job, production.first.id!, job.unitId, scan)).error
      ).toBeNull();
      expect(
        (await issue(f, job, production.first.id!, job.unitId, scan)).error
      ).toBeNull();

      expect((await issue(f, job, production.second.id!)).error).toBeTruthy();
      const offPlan = await invokePosting(
        handlesOf(f.ctx),
        "issue",
        {
          type: "trackedEntitiesToOperation",
          itemId: production.productionItemId,
          jobOperationId: job.operationId,
          parentTrackedEntityId: job.unitId,
          children: [{ trackedEntityId: production.second.id!, quantity: 1 }],
          allowOverIssue: true
        },
        issueMaterial
      );
      expect(offPlan.error?.message).toContain("planned pack-out material");
      const units = await f.db
        .selectFrom("trackedEntity")
        .select(["id", "quantity", "readableId"])
        .where("companyId", "=", f.companyId)
        .where("itemId", "=", job.salesItemId)
        .orderBy("createdAt")
        .execute();
      expect(units).toEqual([
        { id: job.unitId, quantity: 1, readableId: production.first.serial },
        { id: expect.any(String), quantity: 1, readableId: null }
      ]);
      // A reduced target leaves a legitimate reserved spare on this job.
      await f.db
        .updateTable("job")
        .set({ quantity: 1 })
        .where("id", "=", job.jobId)
        .where("companyId", "=", f.companyId)
        .execute();
      expect(
        (await issue(f, job, production.second.id!, units[1]!.id!)).error
          ?.message
      ).toContain("All planned sales units");
      await f.db
        .updateTable("job")
        .set({ quantity: 2 })
        .where("id", "=", job.jobId)
        .where("companyId", "=", f.companyId)
        .execute();
      expect(
        (await issue(f, job, production.first.id!, units[1]!.id!)).error
      ).toBeTruthy();
      const consumption = await f.db
        .selectFrom("itemLedger")
        .select(["trackedEntityId", "quantity"])
        .where("companyId", "=", f.companyId)
        .where("documentId", "=", job.jobId)
        .where("documentType", "=", "Job Consumption")
        .execute();
      expect(consumption).toEqual([
        { trackedEntityId: production.first.id, quantity: -1 }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "returning a paired source restores its own FIFO layer at its issued cost",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const production = await receiveProductionPair(f);
      const job = await createPairedJob(f, production.productionItemId);
      const source = production.first.id!;
      // Provenance can name the original job while itemId identifies its SKU.
      await f.db
        .updateTable("trackedEntity")
        .set({ sourceDocument: "Job", sourceDocumentId: production.jobId })
        .where("id", "=", source)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      await f.db
        .updateTable("trackedEntity")
        .set({ readableId: production.first.serial })
        .where("companyId", "=", f.companyId)
        .where("id", "=", job.unitId)
        .executeTakeFirstOrThrow();
      expect((await issue(f, job, source)).error).toBeNull();
      await f.db
        .updateTable("itemCost")
        .set({ unitCost: 87 })
        .where("companyId", "=", f.companyId)
        .where("itemId", "=", production.productionItemId)
        .returning("itemId")
        .executeTakeFirstOrThrow();
      const activePair = () =>
        f.db
          .selectFrom("jobUnitPairing")
          .select("id")
          .where("companyId", "=", f.companyId)
          .where("outputId", "=", job.unitId)
          .where("releasedAt", "is", null)
          .executeTakeFirstOrThrow();
      const giveBack = (pairingId?: string) =>
        invokePosting(
          handlesOf(f.ctx),
          "issue",
          {
            type: "unconsumeTrackedEntities",
            materialId: job.materialId,
            parentTrackedEntityId: job.unitId,
            pairingId,
            children: [{ trackedEntityId: source, quantity: 1 }]
          },
          issueMaterial
        );
      const firstPair = await activePair();
      expect((await giveBack(firstPair.id)).error).toBeNull();
      const output = await f.db
        .selectFrom("trackedEntity")
        .select("readableId")
        .where("id", "=", job.unitId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(output.readableId).toBe(production.first.serial);
      const layer = () =>
        f.db
          .selectFrom("costLedger")
          .select(["cost", "remainingQuantity"])
          .where("companyId", "=", f.companyId)
          .where("trackedEntityId", "=", source)
          .where("documentType", "=", "Job Consumption")
          .where("documentId", "=", job.jobId)
          .where("quantity", "=", 1)
          .executeTakeFirstOrThrow();
      expect(await layer()).toEqual({ cost: 20, remainingQuantity: 1 });
      expect((await issue(f, job, source)).error).toBeNull();
      expect(await layer()).toEqual({ cost: 20, remainingQuantity: 0 });
      const replacementPair = await activePair();
      expect((await giveBack(firstPair.id)).error).toBeTruthy();
      expect((await giveBack()).error).toBeTruthy();
      expect(await activePair()).toEqual(replacementPair);
      expect((await giveBack(replacementPair.id)).error).toBeNull();
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "scrap followed by recovery cannot number the old output until its replacement is scanned",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const production = await receiveProductionPair(f);
      const job = await createPairedJob(f, production.productionItemId);
      const reason = await f.db
        .insertInto("scrapReason")
        .values({ name: "Damaged", companyId: f.companyId, createdBy: USER })
        .returning("id")
        .executeTakeFirstOrThrow();
      expect((await issue(f, job, production.first.id!)).error).toBeNull();
      const scrap = await invokePosting(
        handlesOf(f.ctx),
        "issue",
        {
          type: "scrapTrackedEntity",
          trackedEntityId: production.first.id!,
          materialId: job.materialId,
          parentTrackedEntityId: job.unitId,
          scrapReasonId: reason.id
        },
        issueMaterial
      );
      expect(scrap.error).toBeNull();
      const recovered = await invokePosting(
        handlesOf(f.ctx),
        "post-inventory-adjustment",
        {
          adjustmentType: "Unscrap",
          quantity: 1,
          itemId: production.productionItemId,
          locationId: f.locationId,
          trackedEntityId: production.first.id!
        },
        postInventoryAdjustment
      );
      expect(recovered.error).toBeNull();
      expect((await complete(f, job)).error).toBeTruthy();
      const output = await f.db
        .selectFrom("trackedEntity")
        .select("readableId")
        .where("id", "=", job.unitId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(output.readableId).toBeNull();
      expect((await issue(f, job, production.second.id!)).error).toBeNull();
      expect((await complete(f, job)).error).toBeNull();
      const links = await f.db
        .selectFrom("jobUnitPairing")
        .select(["sourceId", "releasedAt"])
        .where("companyId", "=", f.companyId)
        .where("outputId", "=", job.unitId)
        .orderBy("serial")
        .execute();
      expect(links).toEqual([
        { sourceId: production.first.id, releasedAt: expect.anything() },
        { sourceId: production.second.id, releasedAt: null }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a competing manual serial edit cannot erase a paired unit's completion marker",
  async () => {
    const f = await alwaysPostFixture();
    const editor = await connectLocalTestDatabase();
    try {
      const production = await receiveProductionPair(f);
      const job = await createPairedJob(f, production.productionItemId);
      expect((await issue(f, job, production.first.id!)).error).toBeNull();
      await sql`SELECT set_config('app.sync_in_progress','false',false)`.execute(
        editor
      );
      const {
        rows: [mes]
      } = await sql<{ pid: number }>`SELECT pg_backend_pid() as pid`.execute(
        f.db
      );
      let result: ReturnType<typeof complete> | undefined;
      try {
        // The planner starts a save while MES is completing. A matching value
        // is a harmless save; changing a serial with an active pair is refused.
        await editor.transaction().execute(async (trx) => {
          await trx
            .selectFrom("trackedEntity")
            .select("id")
            .where("companyId", "=", f.companyId)
            .where("id", "=", job.unitId)
            .forUpdate()
            .executeTakeFirstOrThrow();
          result = complete(f, job);
          await expect
            .poll(
              async () => {
                const {
                  rows: [r]
                } = await sql<{
                  blocked: boolean;
                }>`SELECT pg_backend_pid()=ANY(pg_blocking_pids(${mes!.pid})) AS blocked`.execute(
                  trx
                );
                return r?.blocked;
              },
              { timeout: 5000 }
            )
            .toBe(true);
          await trx
            .updateTable("trackedEntity")
            .set({ readableId: production.first.serial })
            .where("companyId", "=", f.companyId)
            .where("id", "=", job.unitId)
            .returning("id")
            .executeTakeFirstOrThrow();
        });
      } finally {
        if (result) expect((await result).error).toBeNull();
      }
      await expect(
        editor
          .updateTable("trackedEntity")
          .set({ readableId: "MANUAL" })
          .where("companyId", "=", f.companyId)
          .where("id", "=", job.unitId)
          .execute()
      ).rejects.toThrow();
      expect((await complete(f, job)).error).toBeNull();
      const reported = await f.db
        .selectFrom("productionQuantity")
        .select("quantity")
        .where("companyId", "=", f.companyId)
        .where("jobOperationId", "=", job.operationId)
        .where("type", "=", "Production")
        .execute();
      expect(reported).toEqual([{ quantity: 1 }]);
    } finally {
      await editor.destroy();
      await f.cleanup();
    }
  }
);

databaseTest(
  "a delayed scan or completion cannot act on a renamed, returned, or replaced component",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const {
        productionItemId,
        first: a,
        second: b
      } = await receiveProductionPair(f);
      const job = await createPairedJob(f, productionItemId);
      type Command = Parameters<typeof issueMaterial>[1];
      const post = (input: Command) =>
        invokePosting(handlesOf(f.ctx), "issue", input, issueMaterial);
      const scan = (id: string) =>
        confirmPackoutCommand(f, {
          type: "trackedEntitiesToOperation",
          materialId: job.materialId,
          jobOperationId: job.operationId,
          parentTrackedEntityId: job.unitId,
          children: [{ trackedEntityId: id, quantity: 1 }]
        });
      const log = () =>
        confirmPackoutCommand(f, {
          type: "jobOperationSerialComplete",
          jobOperationId: job.operationId,
          trackedEntityId: job.unitId,
          quantity: 1
        });
      const back = (id: string, pairingId: string) =>
        post({
          type: "unconsumeTrackedEntities",
          pairingId,
          materialId: job.materialId,
          parentTrackedEntityId: job.unitId,
          children: [{ trackedEntityId: id, quantity: 1 }]
        });
      const oldLabel = await scan(a.id!);
      await f.db
        .updateTable("trackedEntity")
        .set({ readableId: "RELABELED" })
        .where("id", "=", a.id!)
        .where("companyId", "=", f.companyId)
        .returning("id")
        .executeTakeFirstOrThrow();
      expect((await post(oldLabel)).error?.message).toContain(
        "serial has changed"
      );
      const firstScan = await scan(a.id!);
      expect((await post(firstScan)).error).toBeNull();
      expect((await post(firstScan)).error).toBeNull();
      const delayedLog = await log();
      const pairA = await f.db
        .selectFrom("jobUnitPairing")
        .select("id")
        .where("sourceId", "=", a.id!)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect((await back(a.id!, pairA.id!)).error).toBeNull();
      expect((await post(firstScan)).error?.message).toContain(
        "already been used"
      );
      expect((await post(await scan(b.id!))).error).toBeNull();
      expect((await post(delayedLog)).error?.message).toContain(
        "component has changed"
      );
      const quantities = () =>
        f.db
          .selectFrom("productionQuantity")
          .select("quantity")
          .where("companyId", "=", f.companyId)
          .where("jobOperationId", "=", job.operationId)
          .execute();
      expect(await quantities()).toEqual([]);
      const freshLog = await log();
      expect((await post(freshLog)).error).toBeNull();
      expect((await post(delayedLog)).error?.message).toContain(
        "component has changed"
      );
      expect((await post(freshLog)).error).toBeNull();
      const pairB = await f.db
        .selectFrom("jobUnitPairing")
        .select("id")
        .where("sourceId", "=", b.id!)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect((await back(b.id!, pairB.id!)).error?.message).toContain(
        "logged complete"
      );
      const output = await f.db
        .selectFrom("trackedEntity")
        .select(["readableId", "status"])
        .where("id", "=", job.unitId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(output).toEqual({ readableId: b.serial, status: "Available" });
      expect(await quantities()).toHaveLength(1);
      const posted = await f.db
        .selectFrom("itemLedger")
        .select(["trackedEntityId", "quantity"])
        .where("documentId", "=", job.jobId)
        .where("companyId", "=", f.companyId)
        .where("itemId", "=", productionItemId)
        .orderBy("entryNumber")
        .execute();
      expect(
        posted.map((row) => [row.trackedEntityId, Number(row.quantity)])
      ).toEqual([
        [a.id, -1],
        [a.id, 1],
        [b.id, -1]
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "returning one packed component preserves a concurrent issue on the same material line",
  async () => {
    const f = await alwaysPostFixture();
    const peer = await connectLocalTestDatabase();
    const observer = await connectLocalTestDatabase();
    const pending: Promise<Awaited<ReturnType<typeof issue>>>[] = [];
    try {
      await sql`SELECT set_config('app.sync_in_progress','false',false)`.execute(
        peer
      );
      const {
        productionItemId,
        first: a,
        second: b
      } = await receiveProductionPair(f);
      const job = await createPairedJob(f, productionItemId);
      expect((await issue(f, job, a.id!)).error).toBeNull();
      const blank = await f.db
        .selectFrom("trackedEntity")
        .select("id")
        .where("companyId", "=", f.companyId)
        .where("itemId", "=", job.salesItemId)
        .where(sql<boolean>`attributes->>'Job' = ${job.jobId}`)
        .where("readableId", "is", null)
        .executeTakeFirstOrThrow();
      const scan = await confirmPackoutCommand(f, {
        type: "trackedEntitiesToOperation",
        materialId: job.materialId,
        jobOperationId: job.operationId,
        parentTrackedEntityId: blank.id!,
        children: [{ trackedEntityId: b.id!, quantity: 1 }]
      });
      const pid = async (db: Fixture["db"]) =>
        (await sql<{ id: number }>`SELECT pg_backend_pid() AS id`.execute(db))
          .rows[0]!.id;
      const [issuer, receiver, blocker] = await Promise.all([
        pid(f.db),
        pid(peer),
        pid(observer)
      ]);
      await observer.transaction().execute(async (trx) => {
        await trx
          .selectFrom("trackedEntity")
          .select("id")
          .where("companyId", "=", f.companyId)
          .where("id", "=", b.id!)
          .forUpdate()
          .executeTakeFirstOrThrow();
        const waits = async (waiting: number, holding: number) =>
          (
            await sql<{
              v: boolean;
            }>`SELECT ${holding}::int = ANY(pg_blocking_pids(${waiting})) AS v`.execute(
              trx
            )
          ).rows[0]!.v;
        pending.push(
          invokePosting(handlesOf(f.ctx), "issue", scan, issueMaterial)
        );
        await expect.poll(() => waits(issuer, blocker)).toBe(true);
        pending.push(
          invokePosting(
            handlesOf({ ...f.ctx, db: peer }),
            "issue",
            {
              type: "unconsumeTrackedEntities",
              materialId: job.materialId,
              parentTrackedEntityId: job.unitId,
              children: [{ trackedEntityId: a.id!, quantity: 1 }]
            },
            issueMaterial
          )
        );
        await expect.poll(() => waits(receiver, issuer)).toBe(true);
      });
      expect(
        (await Promise.all(pending)).map((result) => result.error)
      ).toEqual([null, null]);
      const material = await f.db
        .selectFrom("jobMaterial")
        .select("quantityIssued")
        .where("id", "=", job.materialId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(Number(material.quantityIssued)).toBe(1);
      const active = await f.db
        .selectFrom("jobUnitPairing")
        .select("sourceId")
        .where("jobId", "=", job.jobId)
        .where("companyId", "=", f.companyId)
        .where("releasedAt", "is", null)
        .execute();
      expect(active).toEqual([{ sourceId: b.id }]);
      const ledger = await f.db
        .selectFrom("itemLedger")
        .select((eb) => eb.fn.sum("quantity").as("net"))
        .where("companyId", "=", f.companyId)
        .where("documentId", "=", job.jobId)
        .where("itemId", "=", productionItemId)
        .executeTakeFirstOrThrow();
      expect(Number(ledger.net)).toBe(-1);
    } finally {
      await Promise.allSettled(pending);
      await observer.destroy();
      await peer.destroy();
      await f.cleanup();
    }
  }
);

databaseTest(
  "a stocked production unit with legacy Item provenance can be packed and received",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const production = await receiveProductionPair(f);
      const job = await createPairedJob(f, production.productionItemId);
      const source = await f.db
        .updateTable("trackedEntity")
        .set({
          itemId: null,
          sourceDocument: "Item",
          sourceDocumentId: production.productionItemId
        })
        .where("companyId", "=", f.companyId)
        .where("id", "=", production.first.id!)
        .returning(["id", "itemId"])
        .executeTakeFirstOrThrow();
      expect(source.itemId).toBeNull();
      expect((await issue(f, job, source.id!)).error).toBeNull();
      expect((await complete(f, job)).error).toBeNull();
      await sql`SELECT receive_job_to_inventory(
        ${job.jobId}, 1::numeric, ${f.companyId}, ${USER},
        p_expected_serials => ARRAY[${production.first.serial}]::text[]
      )`.execute(f.db);
      const moves = await f.db
        .selectFrom("itemLedger")
        .select(["trackedEntityId", "itemId", "quantity"])
        .where("companyId", "=", f.companyId)
        .where("documentId", "=", job.jobId)
        .orderBy("entryNumber")
        .execute();
      expect(moves).toEqual([
        {
          trackedEntityId: source.id,
          itemId: production.productionItemId,
          quantity: -1
        },
        { trackedEntityId: job.unitId, itemId: job.salesItemId, quantity: 1 }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a legacy sales unit blocks a colliding scan before source debit or pairing",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const production = await receiveProductionPair(f);
      const job = await createPairedJob(f, production.productionItemId);
      const sales = await f.db
        .insertInto("trackedEntity")
        .values({
          sourceDocument: "Item",
          sourceDocumentId: job.salesItemId,
          readableId: production.first.serial,
          quantity: 1,
          status: "Available",
          companyId: f.companyId,
          createdBy: USER
        })
        .returning(["id", "itemId"])
        .executeTakeFirstOrThrow();
      expect(sales.itemId).toBeNull();
      await f.db
        .insertInto("itemLedger")
        .values({
          itemId: job.salesItemId,
          trackedEntityId: sales.id,
          entryType: "Positive Adjmt.",
          quantity: 1,
          locationId: f.locationId,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      expect((await issue(f, job, production.first.id!)).error?.message).toMatch(
        /serial already/
      );
      const pairings = await f.db
        .selectFrom("jobUnitPairing")
        .select("id")
        .where("jobId", "=", job.jobId)
        .where("companyId", "=", f.companyId)
        .execute();
      expect(pairings).toEqual([]);
      const stock = await f.db
        .selectFrom("itemLedger")
        .select("quantity")
        .where("trackedEntityId", "=", production.first.id!)
        .where("companyId", "=", f.companyId)
        .execute();
      expect(stock).toEqual([{ quantity: 1 }]);
    } finally {
      await f.cleanup();
    }
  }
);
