// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.
// A lot's verdicts move only the units it holds, and a closed lot stays closed.

import {
  cancelManualInspection,
  createManualInspection,
  dispositionInspection,
  upsertInspectionSample
} from "@carbon/database/quality";
import { sql } from "kysely";
import { expect } from "vitest";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER
} from "./fixtures/always-post";
import { countUnits } from "./fixtures/count-units";
import {
  connectLocalTestDatabase,
  databaseTest
} from "./fixtures/local-database";

async function setup() {
  const f = await alwaysPostFixture();
  const units = await countUnits(f);
  await seed(f, (trx) =>
    trx
      .insertInto("sequence")
      .values({
        table: "inspection",
        name: "Inspection",
        prefix: "INS-",
        companyId: f.companyId
      })
      .onConflict((oc) => oc.doNothing())
      .execute()
  );
  return { f, units };
}

/** A closed receipt lot over SN-1 and SN-2 (their receipt line); SN-3 is not on it. */
async function receiptLot(f: Fixture, units: Awaited<ReturnType<typeof countUnits>>) {
  const receiptLineId = `${f.prefix}-rl`;
  const lotId = `${f.prefix}-lot`;
  await seed(f, async (trx) => {
    await trx
      .updateTable("trackedEntity")
      .set({
        status: "On Hold",
        attributes: JSON.stringify({ "Receipt Line": receiptLineId })
      })
      .where("id", "in", [units.entity("SN-1"), units.entity("SN-2")])
      .where("companyId", "=", f.companyId)
      .execute();
    await trx
      .insertInto("inspection")
      .values({
        id: lotId,
        inspectionId: `${f.prefix}-INS`,
        sourceDocument: "Receipt",
        sourceDocumentId: `${f.prefix}-receipt`,
        sourceDocumentLineId: receiptLineId,
        itemId: units.serialItemId,
        lotSize: 2,
        samplingStandard: "ANSI_Z1_4",
        samplingPlanType: "All",
        sampleSize: 2,
        acceptanceNumber: 0,
        rejectionNumber: 1,
        status: "Pending",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  return lotId;
}

async function statuses(f: Fixture, ids: string[]) {
  const rows = await f.db
    .selectFrom("trackedEntity")
    .select(["id", "status"])
    .where("id", "in", ids)
    .execute();
  return Object.fromEntries(rows.map((row) => [row.id, row.status]));
}

async function lotStatus(f: Fixture, id: string) {
  return (
    await f.db
      .selectFrom("inspection")
      .select("status")
      .where("id", "=", id)
      .executeTakeFirstOrThrow()
  ).status;
}

function disposition(
  f: Fixture,
  id: string,
  decision: "Accept" | "Reject",
  reason?: string
) {
  return dispositionInspection(f.db, {
    id,
    decision,
    reason,
    companyId: f.companyId,
    dispositionedBy: USER,
    requireSource: ["Receipt", "Manual"]
  });
}

databaseTest(
  "a sample saved while a cancel holds the lot is refused and the lot stays Cancelled",
  async () => {
    const { f, units } = await setup();
    const serial = units.entity("SN-1");
    const id = (
      await createManualInspection(f.db, {
        trackedEntityIds: [serial],
        companyId: f.companyId,
        userId: USER
      })
    ).data!.id;

    const canceller = await connectLocalTestDatabase();
    const watcher = await connectLocalTestDatabase();
    try {
      let release!: () => void;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let holderPid!: () => void;
      let pid = 0;
      const holding = new Promise<void>((resolve) => {
        holderPid = resolve;
      });
      const cancel = canceller.transaction().execute(async (trx) => {
        pid = (
          await sql<{ pid: number }>`SELECT pg_backend_pid() AS pid`.execute(trx)
        ).rows[0]!.pid;
        const cancelled = await cancelManualInspection(trx, {
          inspectionId: id,
          companyId: f.companyId,
          userId: USER
        });
        expect(cancelled.error).toBeNull();
        holderPid();
        await released;
      });
      await holding;

      const saving = upsertInspectionSample(f.db, {
        inspectionId: id,
        trackedEntityId: serial,
        status: "Passed",
        companyId: f.companyId,
        inspectedBy: USER
      });
      // Commit the cancel only once the save waits behind it.
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const { rows } = await sql<{ waiting: number }>`
          SELECT count(*)::int AS waiting FROM pg_stat_activity
          WHERE ${pid} = ANY(pg_blocking_pids(pid))
        `.execute(watcher);
        if (rows[0]!.waiting > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      release();
      await cancel;

      expect((await saving).error).not.toBeNull();
      expect(await lotStatus(f, id)).toBe("Cancelled");
      expect(await statuses(f, [serial])).toEqual({ [serial]: "Available" });
    } finally {
      await canceller.destroy();
      await watcher.destroy();
    }
  }
);

databaseTest("a dispositioned manual lot cannot be dispositioned again", async () => {
  const { f, units } = await setup();
  const serial = units.entity("SN-1");
  const id = (
    await createManualInspection(f.db, {
      trackedEntityIds: [serial],
      companyId: f.companyId,
      userId: USER
    })
  ).data!.id;

  expect((await disposition(f, id, "Reject", "Customer complaint")).error).toBeNull();
  expect((await disposition(f, id, "Accept")).error).not.toBeNull();
  expect(await lotStatus(f, id)).toBe("Failed");
  expect(await statuses(f, [serial])).toEqual({ [serial]: "Rejected" });
});

databaseTest(
  "a decided receipt lot leaves a unit another open lot holds",
  async () => {
    const { f, units } = await setup();
    const lotId = await receiptLot(f, units);
    const [held, other] = [units.entity("SN-1"), units.entity("SN-2")];

    expect((await disposition(f, lotId, "Accept")).error).toBeNull();
    // SN-1 is inspected again, by hand, after the receipt lot closed.
    expect(
      (
        await createManualInspection(f.db, {
          trackedEntityIds: [held],
          companyId: f.companyId,
          userId: USER
        })
      ).error
    ).toBeNull();

    // An accepted receipt lot is decided: a later Reject is refused and moves
    // nothing, so the unit the manual lot holds stays On Hold.
    expect(
      (await disposition(f, lotId, "Reject", "Counterfeit")).error
    ).not.toBeNull();
    expect(await statuses(f, [held, other])).toEqual({
      [held]: "On Hold",
      [other]: "Available"
    });
  }
);

databaseTest("a receipt lot refuses a serial that is not on its receipt line", async () => {
  const { f, units } = await setup();
  const lotId = await receiptLot(f, units);
  const foreign = units.entity("SN-3");

  const sample = await upsertInspectionSample(f.db, {
    inspectionId: lotId,
    trackedEntityId: foreign,
    status: "Failed",
    companyId: f.companyId,
    inspectedBy: USER
  });
  expect(sample.error).not.toBeNull();
  expect(await statuses(f, [foreign])).toEqual({ [foreign]: "Available" });

  const own = await upsertInspectionSample(f.db, {
    inspectionId: lotId,
    trackedEntityId: units.entity("SN-1"),
    status: "Passed",
    companyId: f.companyId,
    inspectedBy: USER
  });
  expect(own.error).toBeNull();
});

databaseTest(
  "a manual inspection takes only an Active plan of the inspected item",
  async () => {
    const { f, units } = await setup();
    const plan = (key: string, partId: string, status: "Draft" | "Active") =>
      ({
        id: `${f.prefix}-plan-${key}`,
        name: key,
        partId,
        status,
        companyId: f.companyId,
        createdBy: USER
      }) as const;
    const plans = [
      plan("other-item", units.batchItemId, "Active"),
      plan("draft", units.serialItemId, "Draft"),
      plan("active", units.serialItemId, "Active")
    ];
    await seed(f, (trx) =>
      trx.insertInto("inspectionDocument").values(plans).execute()
    );

    const create = (inspectionDocumentId: string) =>
      createManualInspection(f.db, {
        trackedEntityIds: [units.entity("SN-1")],
        inspectionDocumentId,
        companyId: f.companyId,
        userId: USER
      });

    expect((await create(plans[0].id)).error).not.toBeNull();
    expect((await create(plans[1].id)).error).not.toBeNull();
    // Refused as a whole: the unit was not held.
    expect(await statuses(f, [units.entity("SN-1")])).toEqual({
      [units.entity("SN-1")]: "Available"
    });
    expect((await create(plans[2].id)).error).toBeNull();
  }
);
