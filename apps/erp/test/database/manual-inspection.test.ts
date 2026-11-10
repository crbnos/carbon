// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.
// A manual inspection holds the tracked entities it inspects, and its verdict
// releases or rejects them, as a receipt lot's does.

import {
  cancelManualInspection,
  createManualInspection,
  deleteManualInspection,
  dispositionInspection,
  upsertInspectionSample
} from "@carbon/database/quality";
import { expect } from "vitest";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER
} from "./fixtures/always-post";
import { countUnits } from "./fixtures/count-units";
import { databaseTest } from "./fixtures/local-database";

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

function create(f: Fixture, trackedEntityIds: string[]) {
  return createManualInspection(f.db, {
    trackedEntityIds,
    companyId: f.companyId,
    userId: USER
  });
}

async function statuses(f: Fixture, ids: string[]) {
  const rows = await f.db
    .selectFrom("trackedEntity")
    .select(["id", "status"])
    .where("id", "in", ids)
    .orderBy("id")
    .execute();
  return Object.fromEntries(rows.map((row) => [row.id, row.status]));
}

async function samples(f: Fixture, inspectionId: string) {
  return f.db
    .selectFrom("inspectionSample")
    .select(["trackedEntityId", "status"])
    .where("inspectionId", "=", inspectionId)
    .orderBy("createdAt")
    .orderBy("id")
    .execute();
}

async function lot(f: Fixture, id: string) {
  return f.db
    .selectFrom("inspection")
    .select(["sourceDocument", "sourceDocumentId", "lotSize", "status"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
}

databaseTest(
  "a manual inspection of serials holds them and is one unit per serial",
  async () => {
    const { f, units } = await setup();
    const ids = [units.entity("SN-1"), units.entity("SN-2")];

    // Picked out of order: the samples still follow the serial numbers.
    const created = await create(f, [...ids].reverse());
    expect(created.error).toBeNull();
    const id = created.data!.id;

    expect(await lot(f, id)).toEqual({
      sourceDocument: "Manual",
      sourceDocumentId: id,
      lotSize: 2,
      status: "Pending"
    });
    expect(await statuses(f, ids)).toEqual({
      [ids[0]]: "On Hold",
      [ids[1]]: "On Hold"
    });
    // The picked serials are its samples, in serial order, with no verdict.
    expect(await samples(f, id)).toEqual([
      { trackedEntityId: ids[0], status: "Pending" },
      { trackedEntityId: ids[1], status: "Pending" }
    ]);
  }
);

databaseTest("a manual inspection of a batch is the batch's quantity", async () => {
  const { f, units } = await setup();
  const created = await create(f, [units.entity("LOT-1")]);
  expect((await lot(f, created.data!.id)).lotSize).toBe(10);
  // A batch lot's samples are the grid's anonymous columns.
  expect(await samples(f, created.data!.id)).toEqual([]);
});

databaseTest(
  "an entity already in an open inspection cannot be inspected again",
  async () => {
    const { f, units } = await setup();
    expect((await create(f, [units.entity("SN-1")])).error).toBeNull();

    const again = await create(f, [units.entity("SN-1"), units.entity("SN-2")]);
    expect(again.error).not.toBeNull();
    // Refused as a whole: SN-2 was not held.
    expect(await statuses(f, [units.entity("SN-2")])).toEqual({
      [units.entity("SN-2")]: "Available"
    });
  }
);

databaseTest("entities of two items are refused", async () => {
  const { f, units } = await setup();
  const created = await create(f, [units.entity("SN-1"), units.entity("LOT-1")]);
  expect(created.error).not.toBeNull();
});

databaseTest(
  "accepting releases the lot's entities, except a failed sample",
  async () => {
    const { f, units } = await setup();
    const ids = [units.entity("SN-1"), units.entity("SN-2"), units.entity("SN-3")];
    const id = (await create(f, ids)).data!.id;

    const failed = await upsertInspectionSample(f.db, {
      inspectionId: id,
      trackedEntityId: units.entity("SN-3"),
      status: "Failed",
      companyId: f.companyId,
      inspectedBy: USER
    });
    expect(failed.error).toBeNull();

    // A no-plan lot inspects every unit, so the two others pass first.
    for (const key of ["SN-1", "SN-2"]) {
      await upsertInspectionSample(f.db, {
        inspectionId: id,
        trackedEntityId: units.entity(key),
        status: "Passed",
        companyId: f.companyId,
        inspectedBy: USER
      });
    }
    await f.db
      .updateTable("inspection")
      .set({ acceptanceNumber: 1 })
      .where("id", "=", id)
      .where("companyId", "=", f.companyId)
      .execute();

    const accepted = await dispositionInspection(f.db, {
      id,
      decision: "Accept",
      companyId: f.companyId,
      dispositionedBy: USER,
      requireSource: ["Receipt", "Manual"]
    });
    expect(accepted.error).toBeNull();
    expect(await statuses(f, ids)).toEqual({
      [ids[0]]: "Available",
      [ids[1]]: "Available",
      [ids[2]]: "Rejected"
    });
  }
);

databaseTest(
  "a lot's sample verdicts are one Inspect activity over every unit",
  async () => {
    const { f, units } = await setup();
    const ids = [units.entity("SN-1"), units.entity("SN-2"), units.entity("SN-3")];
    const id = (await create(f, ids)).data!.id;

    const verdicts: [string, "Passed" | "Failed"][] = [
      ["SN-1", "Passed"],
      ["SN-2", "Passed"],
      ["SN-3", "Failed"],
      // A changed verdict links the unit once.
      ["SN-3", "Passed"]
    ];
    for (const [key, status] of verdicts) {
      const saved = await upsertInspectionSample(f.db, {
        inspectionId: id,
        trackedEntityId: units.entity(key),
        status,
        companyId: f.companyId,
        inspectedBy: USER
      });
      expect(saved.error).toBeNull();
    }

    const activities = await f.db
      .selectFrom("trackedActivity")
      .select(["id", "sourceDocumentReadableId"])
      .where("type", "=", "Inspect")
      .where("sourceDocumentId", "=", id)
      .where("companyId", "=", f.companyId)
      .execute();
    expect(activities).toHaveLength(1);
    expect(activities[0].sourceDocumentReadableId).toMatch(/^INS-/);

    // Each unit is one input at its quantity; nothing is consumed or made.
    const inputs = await f.db
      .selectFrom("trackedActivityInput")
      .select(["trackedEntityId", "quantity"])
      .where("trackedActivityId", "=", activities[0].id)
      .orderBy("trackedEntityId")
      .execute();
    expect(inputs).toEqual(
      [...ids].sort().map((trackedEntityId) => ({ trackedEntityId, quantity: 1 }))
    );
    const outputs = await f.db
      .selectFrom("trackedActivityOutput")
      .select("trackedEntityId")
      .where("trackedActivityId", "=", activities[0].id)
      .execute();
    expect(outputs).toEqual([]);
  }
);

databaseTest("rejecting with a reason rejects every entity of the lot", async () => {
  const { f, units } = await setup();
  const ids = [units.entity("SN-1"), units.entity("SN-2")];
  const id = (await create(f, ids)).data!.id;

  const rejected = await dispositionInspection(f.db, {
    id,
    decision: "Reject",
    reason: "Customer complaint",
    companyId: f.companyId,
    dispositionedBy: USER,
    requireSource: ["Receipt", "Manual"]
  });
  expect(rejected.error).toBeNull();
  expect(rejected.data?.writeOff).toBeNull();
  expect(await statuses(f, ids)).toEqual({
    [ids[0]]: "Rejected",
    [ids[1]]: "Rejected"
  });
});

databaseTest("a serial outside the lot cannot be sampled", async () => {
  const { f, units } = await setup();
  const id = (await create(f, [units.entity("SN-1")])).data!.id;

  const sample = await upsertInspectionSample(f.db, {
    inspectionId: id,
    trackedEntityId: units.entity("SN-2"),
    status: "Passed",
    companyId: f.companyId,
    inspectedBy: USER
  });
  expect(sample.error).not.toBeNull();
  expect(await statuses(f, [units.entity("SN-2")])).toEqual({
    [units.entity("SN-2")]: "Available"
  });
});

databaseTest("a serial is inspected again once its last inspection closed", async () => {
  const { f, units } = await setup();
  const serial = units.entity("SN-1");
  const first = (await create(f, [serial])).data!.id;
  await upsertInspectionSample(f.db, {
    inspectionId: first,
    trackedEntityId: serial,
    status: "Passed",
    companyId: f.companyId,
    inspectedBy: USER
  });
  expect(
    (
      await dispositionInspection(f.db, {
        id: first,
        decision: "Accept",
        companyId: f.companyId,
        dispositionedBy: USER,
        requireSource: ["Receipt", "Manual"]
      })
    ).error
  ).toBeNull();

  const again = await create(f, [serial]);
  expect(again.error).toBeNull();
  expect(await samples(f, again.data!.id)).toEqual([
    { trackedEntityId: serial, status: "Pending" }
  ]);
  expect(await statuses(f, [serial])).toEqual({ [serial]: "On Hold" });
});

// One unit was already On Hold for another reason: giving the lot back must
// not release it.
async function holdBeforeInspection(f: Fixture, trackedEntityId: string) {
  await seed(f, (trx) =>
    trx
      .updateTable("trackedEntity")
      .set({ status: "On Hold" })
      .where("id", "=", trackedEntityId)
      .where("companyId", "=", f.companyId)
      .execute()
  );
}

databaseTest(
  "deleting an untouched manual inspection gives each entity its earlier status",
  async () => {
    const { f, units } = await setup();
    const ids = [units.entity("SN-1"), units.entity("SN-2")];
    await holdBeforeInspection(f, ids[1]);
    const id = (await create(f, ids)).data!.id;

    const deleted = await deleteManualInspection(f.db, {
      inspectionId: id,
      companyId: f.companyId
    });
    expect(deleted.error).toBeNull();

    expect(await statuses(f, ids)).toEqual({
      [ids[0]]: "Available",
      [ids[1]]: "On Hold"
    });
    const left = await f.db
      .selectFrom("inspection")
      .select("id")
      .where("id", "=", id)
      .execute();
    expect(left).toEqual([]);
  }
);

databaseTest(
  "a manual inspection with a verdict is cancelled, not deleted",
  async () => {
    const { f, units } = await setup();
    const ids = [units.entity("SN-1"), units.entity("SN-2"), units.entity("SN-3")];
    await holdBeforeInspection(f, ids[2]);
    const id = (await create(f, ids)).data!.id;
    await upsertInspectionSample(f.db, {
      inspectionId: id,
      trackedEntityId: ids[0],
      status: "Passed",
      companyId: f.companyId,
      inspectedBy: USER
    });

    const deleted = await deleteManualInspection(f.db, {
      inspectionId: id,
      companyId: f.companyId
    });
    expect(deleted.error).not.toBeNull();

    const cancelled = await cancelManualInspection(f.db, {
      inspectionId: id,
      companyId: f.companyId,
      userId: USER
    });
    expect(cancelled.error).toBeNull();

    // The passed unit was already released; the other two get back what they
    // had, and the verdict stays on record.
    expect(await statuses(f, ids)).toEqual({
      [ids[0]]: "Available",
      [ids[1]]: "Available",
      [ids[2]]: "On Hold"
    });
    expect((await lot(f, id)).status).toBe("Cancelled");
    expect(await samples(f, id)).toEqual([
      { trackedEntityId: ids[0], status: "Passed" },
      { trackedEntityId: ids[1], status: "Pending" },
      { trackedEntityId: ids[2], status: "Pending" }
    ]);

    // Closed: no verdict, sample or second cancel after it.
    const accepted = await dispositionInspection(f.db, {
      id,
      decision: "Accept",
      companyId: f.companyId,
      dispositionedBy: USER,
      requireSource: ["Receipt", "Manual"]
    });
    expect(accepted.error).not.toBeNull();
    const sample = await upsertInspectionSample(f.db, {
      inspectionId: id,
      trackedEntityId: ids[1],
      status: "Passed",
      companyId: f.companyId,
      inspectedBy: USER
    });
    expect(sample.error).not.toBeNull();
    expect(
      (
        await cancelManualInspection(f.db, {
          inspectionId: id,
          companyId: f.companyId,
          userId: USER
        })
      ).error
    ).not.toBeNull();
  }
);
