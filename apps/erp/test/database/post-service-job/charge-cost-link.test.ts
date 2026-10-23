// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local stack (SUPABASE_DB_URL and the PostgREST `crbn up`
// started); skipped without one. A charge linked to the reimbursement line
// that paid it takes that line's amount as its cost, and the job posts no
// journal for it: the reimbursement already did.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { sql } from "kysely";
import { describe, expect, it } from "vitest";
import {
  getLinkableCostLines,
  getServiceJobItems,
  upsertServiceJobCharge
} from "../../../app/modules/service/service.server";
import { isChargeCostLinkTaken } from "../../../app/modules/service/service.service";
import { hasLocalDatabase } from "../fixtures/local-database";
import { localServiceRoleClient } from "../fixtures/local-supabase";
import { PROJECT_TEST_USER } from "../fixtures/project-posting";
import { serviceJobFixture } from "../fixtures/service-job";

const client = hasLocalDatabase ? localServiceRoleClient() : null;

type Fixture = Awaited<ReturnType<typeof serviceJobFixture>>;

function contextFor(f: Fixture) {
  return createServiceContext({
    actor: { type: "system", onBehalfOf: PROJECT_TEST_USER },
    company: { id: f.companyId, groupId: f.groupId },
    caller: client!,
    system: () => client!,
    pg: () => f.db,
    kv: () => {
      throw new Error("A charge reads no cache");
    }
  });
}

/** A Posted reimbursement of one $180 hotel line to `accountId`. */
async function addPostedReimbursement(f: Fixture, accountId: string) {
  const employeeTypeId = `${f.prefix}-employee-type`;
  const reimbursementId = `${f.prefix}-reimbursement`;
  const lineId = `${f.prefix}-reimbursement-line`;
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    // The employee is only an FK target; its sync interceptors need a
    // provisioned company, so it goes in with triggers off.
    await sql`SET LOCAL session_replication_role = replica`.execute(trx);
    await trx
      .insertInto("employeeType")
      .values({ id: employeeTypeId, name: "Employee", companyId: f.companyId })
      .execute();
    await trx
      .insertInto("employee")
      .values({
        id: PROJECT_TEST_USER,
        companyId: f.companyId,
        employeeTypeId,
        active: true
      })
      .execute();
    await sql`SET LOCAL session_replication_role = origin`.execute(trx);
    await trx
      .insertInto("reimbursement")
      .values({
        id: reimbursementId,
        reimbursementId: `${f.prefix}-REIMB`,
        employeeId: PROJECT_TEST_USER,
        status: "Draft",
        reimbursementDate: "2026-10-01",
        currencyCode: "USD",
        exchangeRate: 1,
        amount: 180,
        companyId: f.companyId,
        createdBy: PROJECT_TEST_USER
      })
      .execute();
    await trx
      .insertInto("reimbursementLine")
      .values({
        id: lineId,
        reimbursementId,
        accountId,
        description: "Hotel",
        amount: 180,
        sequence: 0,
        companyId: f.companyId,
        createdBy: PROJECT_TEST_USER
      })
      .execute();
    await trx
      .updateTable("reimbursement")
      .set({
        status: "Posted",
        postingDate: "2026-10-01",
        postedAt: "2026-10-01T12:00:00Z",
        postedBy: PROJECT_TEST_USER
      })
      .where("id", "=", reimbursementId)
      .execute();
  });
  return { reimbursementId, lineId };
}

async function journalCount(f: Fixture) {
  const row = await f.db
    .selectFrom("journal")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

describe.skipIf(!client)("a charge's paid cost", () => {
  it("links a reimbursement line: the cost is its amount, and no journal posts", async () => {
    const f = await serviceJobFixture();
    try {
      const ctx = contextFor(f);
      const { locationId } = await f.addStockedItem("unit", {
        quantity: 1,
        unitCost: 10
      });
      const job = await f.addJob({ locationId, coverage: "Billable" });
      const other = await f.addJob({ locationId, coverage: "Billable" });
      const reimbursement = await addPostedReimbursement(
        f,
        f.account("cost-of-service")
      );
      const charge = {
        itemId: f.laborItemId,
        description: "Hotel",
        quantity: 2,
        unitPrice: 120,
        billable: true
      };

      const listed = await getLinkableCostLines(ctx, {
        serviceJobId: job.id
      });
      expect(listed.error).toBeNull();
      expect(listed.data?.coverageAccount?.id).toBe(
        f.account("cost-of-service")
      );
      expect(listed.data?.lines).toEqual([
        expect.objectContaining({
          source: "reimbursement",
          id: reimbursement.lineId,
          documentReadableId: `${f.prefix}-REIMB`,
          amount: 180,
          accountId: f.account("cost-of-service")
        })
      ]);

      const journals = await journalCount(f);
      const saved = await upsertServiceJobCharge(ctx, {
        ...charge,
        serviceJobId: job.id,
        reimbursementLineId: reimbursement.lineId
      });
      expect(saved.error).toBeNull();
      const itemId = saved.data?.id as string;
      const row = await f.db
        .selectFrom("serviceJobItem")
        .select(["unitCost", "reimbursementLineId", "purchaseInvoiceLineId"])
        .where("id", "=", itemId)
        .executeTakeFirstOrThrow();
      expect({ ...row, unitCost: Number(row.unitCost) }).toEqual({
        unitCost: 90,
        reimbursementLineId: reimbursement.lineId,
        purchaseInvoiceLineId: null
      });
      expect(await journalCount(f)).toBe(journals);

      // The Parts section names the document that paid it.
      const items = await getServiceJobItems(ctx, { jobId: job.id });
      expect(
        items.data?.[0]?.reimbursementLine?.reimbursement?.reimbursementId
      ).toBe(`${f.prefix}-REIMB`);

      // The line pays one charge: another job's charge is refused, and the
      // line drops out of that job's picker.
      const twice = await upsertServiceJobCharge(ctx, {
        ...charge,
        serviceJobId: other.id,
        reimbursementLineId: reimbursement.lineId
      });
      expect(twice.error?.message).toMatch(/already pays a charge on SJ-/);

      // The index holds the rule when two saves race past that check, and
      // the operation names it with the same message.
      const raced = await client!.from("serviceJobItem").insert({
        serviceJobId: other.id,
        lineType: "Charge",
        itemId: f.laborItemId,
        description: "Hotel",
        quantity: 1,
        unitPrice: 0,
        reimbursementLineId: reimbursement.lineId,
        companyId: f.companyId,
        createdBy: PROJECT_TEST_USER
      });
      expect(raced.error?.code).toBe("23505");
      expect(isChargeCostLinkTaken(raced.error)).toBe(true);
      const otherList = await getLinkableCostLines(ctx, {
        serviceJobId: other.id
      });
      expect(otherList.data?.lines).toEqual([]);

      // The charge itself still lists its line, and saving it again keeps it.
      const ownList = await getLinkableCostLines(ctx, {
        serviceJobId: job.id,
        serviceJobItemId: itemId
      });
      expect(ownList.data?.lines.map((line) => line.id)).toEqual([
        reimbursement.lineId
      ]);
      const resaved = await upsertServiceJobCharge(ctx, {
        ...charge,
        id: itemId,
        quantity: 1,
        serviceJobId: job.id,
        reimbursementLineId: reimbursement.lineId
      });
      expect(resaved.error).toBeNull();

      // Unlinked, the charge has no cost again.
      const unlinked = await upsertServiceJobCharge(ctx, {
        ...charge,
        id: itemId,
        serviceJobId: job.id
      });
      expect(unlinked.error).toBeNull();
      const after = await f.db
        .selectFrom("serviceJobItem")
        .select(["unitCost", "reimbursementLineId"])
        .where("id", "=", itemId)
        .executeTakeFirstOrThrow();
      expect({ ...after, unitCost: Number(after.unitCost) }).toEqual({
        unitCost: 0,
        reimbursementLineId: null
      });
      expect(await journalCount(f)).toBe(journals);
    } finally {
      await f.cleanup();
    }
  });
});
