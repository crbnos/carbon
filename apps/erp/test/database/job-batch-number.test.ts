// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The job page's Serial / Batch Number field writes as the system, as the
// route always did, so it may only reach a unit of the job it names, and only
// while the job is open. Runs against the local stack (SUPABASE_DB_URL and its
// PostgREST); skipped without one.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { updateJobBatchNumber } from "../../app/modules/production/production.server";
import {
  alwaysPostFixture,
  type Fixture,
  jobFixture,
  seed,
  USER
} from "./fixtures/always-post";
import { hasLocalDatabase } from "./fixtures/local-database";
import { localServiceRoleClient } from "./fixtures/local-supabase";

const serviceRole = hasLocalDatabase ? localServiceRoleClient() : null;

// The trackedEntity write needs inventory update under RLS and the field
// needs production update only: touching the caller's client fails the test.
const untouched = new Proxy(
  {},
  {
    get(_, key) {
      throw new Error(`The write must not run as the caller (${String(key)})`);
    }
  }
);

describe.skipIf(!serviceRole)("updateJobBatchNumber", () => {
  let f: Fixture;
  let jobId: string;
  let otherJobId: string;

  beforeAll(async () => {
    f = await alwaysPostFixture();
    jobId = (await jobFixture(f, "1")).jobId;
    otherJobId = (await jobFixture(f, "2")).jobId;
  }, 60_000);

  afterAll(async () => {
    await f?.cleanup();
  }, 60_000);

  function contextFor() {
    return createServiceContext({
      actor: {
        type: "apiKey",
        createdBy: USER,
        scopes: {
          production: {
            view: [],
            create: [],
            update: [f.companyId],
            delete: []
          }
        }
      },
      company: { id: f.companyId, groupId: f.groupId },
      caller: untouched as never,
      system: () => serviceRole!,
      pg: () => f.db,
      kv: () => {
        throw new Error("No kv in a database test");
      }
    });
  }

  /** A unit of the job's root make method, numbered `readableId`. */
  async function unitOf(job: string, key: string, readableId: string) {
    const makeMethod = await f.db
      .selectFrom("jobMakeMethod")
      .select("id")
      .where("jobId", "=", job)
      .where("companyId", "=", f.companyId)
      .executeTakeFirstOrThrow();
    const id = `${f.prefix}-unit-${key}`;
    await seed(f, (trx) =>
      trx
        .insertInto("trackedEntity")
        .values({
          id,
          readableId,
          quantity: 1,
          status: "Reserved",
          sourceDocument: "Item",
          sourceDocumentId: f.assemblyId,
          itemId: f.assemblyId,
          attributes: { "Job Make Method": makeMethod.id },
          companyId: f.companyId,
          createdBy: USER
        })
        .execute()
    );
    return id;
  }

  const numberOf = async (id: string) =>
    (
      await f.db
        .selectFrom("trackedEntity")
        .select("readableId")
        .where("id", "=", id)
        .executeTakeFirstOrThrow()
    ).readableId;

  it("renames a unit of the job as the system, trimmed", async () => {
    const unit = await unitOf(jobId, "own", "SN-1");

    const result = await updateJobBatchNumber(contextFor(), {
      jobId,
      trackedEntityId: unit,
      value: "  SN-7 "
    });

    expect(result).toEqual({
      data: { id: unit, readableId: "SN-7" },
      error: null
    });
    expect(await numberOf(unit)).toBe("SN-7");
  });

  it("clears the number for a blank value", async () => {
    const unit = await unitOf(jobId, "blank", "SN-2");

    await updateJobBatchNumber(contextFor(), {
      jobId,
      trackedEntityId: unit,
      value: " "
    });

    expect(await numberOf(unit)).toBeNull();
  });

  it("refuses a unit of another job", async () => {
    const unit = await unitOf(otherJobId, "other", "SN-3");

    const result = await updateJobBatchNumber(contextFor(), {
      jobId,
      trackedEntityId: unit,
      value: "SN-8"
    });

    expect(result.error?.category).toBe("notFound");
    expect(await numberOf(unit)).toBe("SN-3");
  });

  it("refuses a unit of a completed job", async () => {
    const unit = await unitOf(otherJobId, "locked", "SN-4");
    await seed(f, (trx) =>
      trx
        .updateTable("job")
        .set({ status: "Completed" })
        .where("id", "=", otherJobId)
        .where("companyId", "=", f.companyId)
        .execute()
    );

    const result = await updateJobBatchNumber(contextFor(), {
      jobId: otherJobId,
      trackedEntityId: unit,
      value: "SN-9"
    });

    expect(result.error?.category).toBe("rule");
    expect(await numberOf(unit)).toBe("SN-4");
  });
});
