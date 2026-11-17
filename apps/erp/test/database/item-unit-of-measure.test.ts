// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database; skipped without it. The fixture's part is
// a material on the assembly's make method and on a job for the assembly.

import { expect } from "vitest";
import { writeItemUnitOfMeasure } from "../../app/modules/items/items.service";
import {
  alwaysPostFixture,
  type Fixture,
  jobFixture,
  seed,
  USER
} from "./fixtures/always-post";
import { databaseTest } from "./fixtures/local-database";

type MethodStatus = "Draft" | "Active" | "Archived";
type JobStatus = "Draft" | "Planned" | "Ready" | "Completed";

async function setup(
  f: Fixture,
  { method, job }: { method: MethodStatus; job: JobStatus }
) {
  const makeMethod = await f.db
    .selectFrom("makeMethod")
    .select(["id", "version"])
    .where("itemId", "=", f.assemblyId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  const { jobId } = await jobFixture(f);
  await seed(f, async (trx) => {
    await trx
      .insertInto("unitOfMeasure")
      .values({ code: "FT", name: "Feet", companyId: f.companyId, createdBy: USER })
      .execute();
    await trx
      .updateTable("item")
      .set({ unitOfMeasureCode: "EA" })
      .where("id", "=", f.partId)
      .execute();
    await trx
      .updateTable("makeMethod")
      .set({ status: method })
      .where("id", "=", makeMethod.id)
      .execute();
    await trx
      .insertInto("methodMaterial")
      .values({
        makeMethodId: makeMethod.id,
        itemId: f.partId,
        itemType: "Part",
        quantity: 2,
        unitOfMeasureCode: "EA",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .updateTable("job")
      .set({ status: job })
      .where("id", "=", jobId)
      .execute();
  });
  const assembly = await f.db
    .selectFrom("item")
    .select("readableIdWithRevision")
    .where("id", "=", f.assemblyId)
    .executeTakeFirstOrThrow();
  return {
    methodLabel: `${assembly.readableIdWithRevision} v${makeMethod.version}`,
    jobLabel: "J-1"
  };
}

const changeToFeet = (f: Fixture) =>
  f.db.transaction().execute((trx) =>
    writeItemUnitOfMeasure(trx, {
      itemIds: [f.partId],
      companyId: f.companyId,
      userId: USER,
      unitOfMeasureCode: "FT"
    })
  );

async function units(f: Fixture) {
  const [item, method, job] = await Promise.all([
    f.db
      .selectFrom("item")
      .select("unitOfMeasureCode")
      .where("id", "=", f.partId)
      .executeTakeFirstOrThrow(),
    f.db
      .selectFrom("methodMaterial")
      .select("unitOfMeasureCode")
      .where("itemId", "=", f.partId)
      .where("companyId", "=", f.companyId)
      .executeTakeFirstOrThrow(),
    f.db
      .selectFrom("jobMaterial")
      .select("unitOfMeasureCode")
      .where("itemId", "=", f.partId)
      .where("companyId", "=", f.companyId)
      .executeTakeFirstOrThrow()
  ]);
  return {
    item: item.unitOfMeasureCode,
    method: method.unitOfMeasureCode,
    job: job.unitOfMeasureCode
  };
}

const unitTest = (name: string, fn: (f: Fixture) => Promise<void>) =>
  databaseTest(name, async () => {
    const f = await alwaysPostFixture();
    try {
      await fn(f);
    } finally {
      await f.cleanup();
    }
  });

unitTest(
  "copies a new unit to Draft method and Draft job materials",
  async (f) => {
    await setup(f, { method: "Draft", job: "Draft" });
    expect(await changeToFeet(f)).toBeNull();
    expect(await units(f)).toEqual({ item: "FT", method: "FT", job: "FT" });
  }
);

unitTest("copies to Planned jobs too", async (f) => {
  await setup(f, { method: "Draft", job: "Planned" });
  expect(await changeToFeet(f)).toBeNull();
  expect(await units(f)).toEqual({ item: "FT", method: "FT", job: "FT" });
});

unitTest(
  "leaves Archived methods and finished jobs in the unit they were made in",
  async (f) => {
    await setup(f, { method: "Archived", job: "Completed" });
    expect(await changeToFeet(f)).toBeNull();
    expect(await units(f)).toEqual({ item: "FT", method: "EA", job: "EA" });
  }
);

unitTest(
  "refuses while an Active method uses the item, naming it, and writes nothing",
  async (f) => {
    const { methodLabel } = await setup(f, { method: "Active", job: "Draft" });
    const refusal = await changeToFeet(f);
    expect(refusal).toContain(`Active methods ${methodLabel}`);
    expect(refusal).not.toContain("released jobs");
    expect(await units(f)).toEqual({ item: "EA", method: "EA", job: "EA" });
  }
);

unitTest(
  "refuses while a released job uses the item, naming it, and writes nothing",
  async (f) => {
    const { jobLabel } = await setup(f, { method: "Draft", job: "Ready" });
    const refusal = await changeToFeet(f);
    expect(refusal).toContain(`released jobs ${jobLabel}`);
    expect(refusal).not.toContain("Active methods");
    expect(await units(f)).toEqual({ item: "EA", method: "EA", job: "EA" });
  }
);

unitTest("writes nothing when the unit is unchanged", async (f) => {
  await setup(f, { method: "Active", job: "Ready" });
  const refusal = await f.db.transaction().execute((trx) =>
    writeItemUnitOfMeasure(trx, {
      itemIds: [f.partId],
      companyId: f.companyId,
      userId: USER,
      unitOfMeasureCode: "EA"
    })
  );
  expect(refusal).toBeNull();
});
