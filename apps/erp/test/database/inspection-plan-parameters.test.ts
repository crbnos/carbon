// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.
// The plan editor saves a plan's parameters as the whole list, with ids it
// minted: the save makes the rows exactly that list and never touches
// another plan's row.

import { expect } from "vitest";
import { replaceInspectionDocumentParameters } from "../../app/modules/quality/quality.service";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER
} from "./fixtures/always-post";
import { databaseTest } from "./fixtures/local-database";

async function plan(f: Fixture, id: string) {
  await seed(f, (trx) =>
    trx
      .insertInto("inspectionDocument")
      .values({
        id,
        companyId: f.companyId,
        partId: f.partId,
        name: id,
        createdBy: USER
      })
      .execute()
  );
  return id;
}

function save(
  f: Fixture,
  inspectionDocumentId: string,
  parameters: { id: string; key: string; value: string }[]
) {
  return replaceInspectionDocumentParameters(f.db, {
    inspectionDocumentId,
    companyId: f.companyId,
    userId: USER,
    parameters
  });
}

databaseTest(
  "a save makes the parameters exactly the list sent, in its order",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const id = await plan(f, `${f.prefix}-plan`);
      await save(f, id, [
        { id: `${f.prefix}-p1`, key: "Ambient temp", value: "20 °C" },
        { id: `${f.prefix}-p2`, key: "Fixture", value: "F-12" },
        { id: `${f.prefix}-p3`, key: "Humidity", value: "< 60%" }
      ]);

      // Fixture moves first and changes value; Humidity is removed.
      const saved = await save(f, id, [
        { id: `${f.prefix}-p2`, key: "Fixture", value: "F-14" },
        { id: `${f.prefix}-p1`, key: "Ambient temp", value: "20 °C" }
      ]);

      expect(saved).toEqual([
        { id: `${f.prefix}-p2`, key: "Fixture", value: "F-14", sortOrder: 0 },
        {
          id: `${f.prefix}-p1`,
          key: "Ambient temp",
          value: "20 °C",
          sortOrder: 1
        }
      ]);
      expect(await save(f, id, [])).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a save that names another plan's parameter changes neither plan",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const first = await plan(f, `${f.prefix}-plan-a`);
      const second = await plan(f, `${f.prefix}-plan-b`);
      await save(f, first, [
        { id: `${f.prefix}-a1`, key: "Fixture", value: "F-12" }
      ]);
      await save(f, second, [
        { id: `${f.prefix}-b1`, key: "Torque", value: "4 Nm" }
      ]);

      await expect(
        save(f, second, [
          { id: `${f.prefix}-a1`, key: "Fixture", value: "Overwritten" }
        ])
      ).rejects.toThrow();

      const rows = await f.db
        .selectFrom("inspectionDocumentParameter")
        .select(["inspectionDocumentId", "id", "value"])
        .where("companyId", "=", f.companyId)
        .orderBy("id")
        .execute();
      expect(rows).toEqual([
        { inspectionDocumentId: first, id: `${f.prefix}-a1`, value: "F-12" },
        { inspectionDocumentId: second, id: `${f.prefix}-b1`, value: "4 Nm" }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);
