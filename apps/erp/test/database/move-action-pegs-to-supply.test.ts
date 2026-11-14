// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.

// A grouped Order / Make moves its planning action's pegs onto the PO lines or
// jobs that answered it, split by quantity. What a partial order does not
// cover stays on the action, which projectPeg_planned_check allows only as a
// Soft peg. Every moved peg is superseded, never updated in place.

import { afterEach, beforeEach, describe, expect } from "vitest";
import { moveActionPegsToSupply } from "../../app/modules/projects/projects.service";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER
} from "./fixtures/always-post";
import { databaseTest, hasLocalDatabase } from "./fixtures/local-database";

let f: Fixture;
let groupId: string;
let projectA: string;
let projectB: string;

/** A Soft peg of `projectId`'s demand on the planning action `actionId`. */
async function pegOnAction(
  actionId: string,
  projectId: string,
  quantity: number,
  needDate: string
) {
  await seed(f, (trx) =>
    trx
      .insertInto("projectPeg")
      .values({
        companyId: f.companyId,
        planningGroupId: groupId,
        itemId: f.partId,
        locationId: f.locationId,
        supplyType: "Planning Action",
        supplyId: actionId,
        projectId,
        demandSourceType: "Project Material",
        demandSourceId: `${f.prefix}-demand-${projectId}`,
        quantity,
        needDate,
        state: "Soft",
        createdBy: USER
      })
      .execute()
  );
}

/** The current pegs, as (supply, project, quantity) sorted for comparison. */
async function currentPegs() {
  const rows = await f.db
    .selectFrom("projectPeg")
    .select(["supplyType", "supplyId", "projectId", "quantity", "state"])
    .where("companyId", "=", f.companyId)
    .where("supersededAt", "is", null)
    .execute();
  return rows
    .map((row) => ({
      supply: `${row.supplyType}:${row.supplyId}`,
      projectId: row.projectId,
      quantity: Number(row.quantity),
      state: row.state
    }))
    .sort((a, b) =>
      `${a.supply}${a.projectId}${a.quantity}`.localeCompare(
        `${b.supply}${b.projectId}${b.quantity}`
      )
    );
}

async function supersededCount() {
  const row = await f.db
    .selectFrom("projectPeg")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("companyId", "=", f.companyId)
    .where("supersededAt", "is not", null)
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

describe.skipIf(!hasLocalDatabase)("moveActionPegsToSupply", () => {
  beforeEach(async () => {
    f = await alwaysPostFixture();
    groupId = `${f.prefix}-group-plan`;
    projectA = `${f.prefix}-project-a`;
    projectB = `${f.prefix}-project-b`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("project")
        .values([
          { id: projectA, name: "A", companyId: f.companyId, createdBy: USER },
          { id: projectB, name: "B", companyId: f.companyId, createdBy: USER }
        ])
        .execute();
      await trx
        .insertInto("planningGroup")
        .values({
          id: groupId,
          name: "Group",
          locationId: f.locationId,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
    });
  });

  afterEach(async () => {
    await f.cleanup();
  });

  databaseTest(
    "moves every peg onto the job that covers the whole action",
    async () => {
      await pegOnAction("pa_1", projectA, 20, "2026-11-10");
      await pegOnAction("pa_1", projectB, 30, "2026-11-12");
      const result = await moveActionPegsToSupply(f.db, {
        companyId: f.companyId,
        userId: USER,
        moves: [
          {
            planningActionId: "pa_1",
            supplyType: "Job",
            supplies: [{ supplyId: "job_1", quantity: 50, dueDate: "2026-11-30" }],
            keepRemainder: false
          }
        ]
      });
      expect(result).toEqual({ moved: 2, error: null });
      expect(await currentPegs()).toEqual([
        { supply: "Job:job_1", projectId: projectA, quantity: 20, state: "Soft" },
        { supply: "Job:job_1", projectId: projectB, quantity: 30, state: "Soft" }
      ]);
      expect(await supersededCount()).toBe(2);
    }
  );

  databaseTest(
    "splits the pegs across the jobs a week was ordered as, earliest need first",
    async () => {
      await pegOnAction("pa_1", projectB, 30, "2026-11-20");
      await pegOnAction("pa_1", projectA, 40, "2026-11-05");
      await moveActionPegsToSupply(f.db, {
        companyId: f.companyId,
        userId: USER,
        moves: [
          {
            planningActionId: "pa_1",
            supplyType: "Job",
            supplies: [
              { supplyId: "job_1", quantity: 50, dueDate: "2026-11-30" },
              { supplyId: "job_2", quantity: 20, dueDate: "2026-11-30" }
            ],
            keepRemainder: false
          }
        ]
      });
      // A needs 40 first: all of it on job_1; B's 30 is job_1's last 10 and 20
      // on job_2
      expect(await currentPegs()).toEqual([
        { supply: "Job:job_1", projectId: projectA, quantity: 40, state: "Soft" },
        { supply: "Job:job_1", projectId: projectB, quantity: 10, state: "Soft" },
        { supply: "Job:job_2", projectId: projectB, quantity: 20, state: "Soft" }
      ]);
    }
  );

  databaseTest(
    "leaves what a partial order does not cover on the open action",
    async () => {
      await pegOnAction("pa_1", projectA, 20, "2026-11-10");
      await pegOnAction("pa_1", projectB, 30, "2026-11-12");
      await moveActionPegsToSupply(f.db, {
        companyId: f.companyId,
        userId: USER,
        moves: [
          {
            planningActionId: "pa_1",
            supplyType: "Purchase Order Line",
            supplies: [{ supplyId: "pol_1", quantity: 35, dueDate: "2026-11-30" }],
            keepRemainder: true
          }
        ]
      });
      expect(await currentPegs()).toEqual([
        {
          supply: "Planning Action:pa_1",
          projectId: projectB,
          quantity: 15,
          state: "Soft"
        },
        {
          supply: "Purchase Order Line:pol_1",
          projectId: projectA,
          quantity: 20,
          state: "Soft"
        },
        {
          supply: "Purchase Order Line:pol_1",
          projectId: projectB,
          quantity: 15,
          state: "Soft"
        }
      ]);

      // the next order for the rest moves the remainder too
      await moveActionPegsToSupply(f.db, {
        companyId: f.companyId,
        userId: USER,
        moves: [
          {
            planningActionId: "pa_1",
            supplyType: "Purchase Order Line",
            supplies: [{ supplyId: "pol_2", quantity: 15, dueDate: "2026-11-30" }],
            keepRemainder: false
          }
        ]
      });
      expect(
        (await currentPegs()).filter((peg) =>
          peg.supply.startsWith("Planning Action")
        )
      ).toEqual([]);
      expect(await currentPegs()).toContainEqual({
        supply: "Purchase Order Line:pol_2",
        projectId: projectB,
        quantity: 15,
        state: "Soft"
      });
    }
  );

  databaseTest("never touches another action's pegs", async () => {
    await pegOnAction("pa_1", projectA, 10, "2026-11-10");
    await pegOnAction("pa_2", projectB, 10, "2026-11-10");
    await moveActionPegsToSupply(f.db, {
      companyId: f.companyId,
      userId: USER,
      moves: [
        {
          planningActionId: "pa_1",
          supplyType: "Job",
          supplies: [{ supplyId: "job_1", quantity: 10, dueDate: "2026-11-30" }],
          keepRemainder: false
        }
      ]
    });
    expect(await currentPegs()).toEqual([
      { supply: "Job:job_1", projectId: projectA, quantity: 10, state: "Soft" },
      {
        supply: "Planning Action:pa_2",
        projectId: projectB,
        quantity: 10,
        state: "Soft"
      }
    ]);
  });
});
