// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { type Fixture, jobFixture, seed, USER } from "./always-post";

/**
 * A job of serial units SN-001…, each its own row and Available, as after an
 * earlier operation: the receipt ranks them by serial number alone.
 */
export async function serialJob(f: Fixture, quantity: number) {
  const job = await jobFixture(f, "hold");
  const makeMethod = await f.db
    .selectFrom("jobMakeMethod")
    .select("id")
    .where("jobId", "=", job.jobId)
    .where("parentMaterialId", "is", null)
    .executeTakeFirstOrThrow();
  await seed(f, async (trx) => {
    await trx
      .updateTable("item")
      .set({ itemTrackingType: "Serial" })
      .where("id", "=", f.assemblyId)
      .execute();
    await trx
      .updateTable("job")
      .set({ status: "In Progress", quantity })
      .where("id", "=", job.jobId)
      .execute();
    await trx
      .updateTable("jobMakeMethod")
      .set({ requiresSerialTracking: true })
      .where("id", "=", makeMethod.id)
      .execute();
    await trx
      .deleteFrom("trackedEntity")
      .where("companyId", "=", f.companyId)
      .where(sql<boolean>`attributes->>'Job Make Method' = ${makeMethod.id}`)
      .execute();
    await trx
      .insertInto("trackedEntity")
      .values(
        Array.from({ length: quantity }, (_, index) => ({
          id: `${f.prefix}-unit-${index + 1}`,
          readableId: `SN-00${index + 1}`,
          quantity: 1,
          status: "Available" as const,
          sourceDocument: "Job",
          sourceDocumentId: job.jobId,
          sourceDocumentReadableId: "J-hold",
          itemId: f.assemblyId,
          attributes: { Job: job.jobId, "Job Make Method": makeMethod.id },
          companyId: f.companyId,
          createdBy: USER
        }))
      )
      .execute();
  });
  return { ...job, makeMethodId: makeMethod.id };
}

export async function holdUnits(f: Fixture, on: boolean) {
  await seed(f, async (trx) => {
    await trx
      .updateTable("companySettings")
      .set({ holdUnitsWithOpenIssues: on })
      .where("id", "=", f.companyId)
      .execute();
  });
}

/** An open issue linked to unit `number` (SN-00<number>). */
export async function raiseIssue(
  f: Fixture,
  number: number,
  issueNumber = number
) {
  return raiseIssueOnUnit(f, `${f.prefix}-unit-${number}`, issueNumber);
}

export async function raiseIssueOnUnit(
  f: Fixture,
  trackedEntityId: string,
  issueNumber: number
) {
  const issueId = `${f.prefix}-issue-${issueNumber}`;
  await seed(f, async (trx) => {
    await trx
      .insertInto("nonConformanceType")
      .values({
        id: `${f.prefix}-issue-type-${issueNumber}`,
        name: `Defect ${issueNumber}`,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("nonConformance")
      .values({
        id: issueId,
        nonConformanceId: `NCR-${issueNumber}`,
        name: "Cracked housing",
        source: "Internal",
        locationId: f.locationId,
        nonConformanceTypeId: `${f.prefix}-issue-type-${issueNumber}`,
        openDate: "2026-11-23",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("nonConformanceTrackedEntity")
      .values({
        nonConformanceId: issueId,
        trackedEntityId,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  return issueId;
}
