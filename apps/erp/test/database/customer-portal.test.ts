// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local stack (SUPABASE_DB_URL and the PostgREST `crbn up`
// started); skipped without one. The customer portal is an open link, so what
// its reads return is what anyone holding the link sees.

import { afterAll, beforeAll, describe, expect, vi } from "vitest";
import {
  alwaysPostFixture,
  type Fixture,
  jobFixture,
  seed,
  USER
} from "./fixtures/always-post";
import { hasLocalDatabase } from "./fixtures/local-database";
import { postgrestTest } from "./fixtures/local-supabase";

// The portal is a commercial feature, off in the community edition that an
// unset CARBON_EDITION reads as. Set before @carbon/env is imported.
vi.hoisted(() => {
  process.env.CARBON_EDITION = "enterprise";
});

const { getJobOperationFileRecord } = await import(
  "../../app/modules/production/production.service"
);
const { getActiveCustomerPortal, getExternalSalesOrderLines } = await import(
  "../../app/modules/sales/sales.service"
);

let f: Fixture;
let other: Fixture;
let operationId: string;
let otherOperationId: string;
let filePath: string;
let checkboxPath: string;
let portalId: string;

beforeAll(async () => {
  if (!hasLocalDatabase) return;
  f = await alwaysPostFixture();
  other = await alwaysPostFixture();
  operationId = (await jobFixture(f, "1")).operationId;
  otherOperationId = (await jobFixture(f, "2")).operationId;
  filePath = `${f.companyId}/job/${operationId}/step/abc/photo.png`;
  checkboxPath = `${f.companyId}/job/${operationId}/step/def/scan.png`;
  portalId = crypto.randomUUID();

  await seed(f, async (trx) => {
    const steps = await trx
      .insertInto("jobOperationStep")
      .values([
        {
          operationId,
          name: "Photo",
          type: "File",
          companyId: f.companyId,
          createdBy: USER
        },
        {
          operationId,
          name: "Checked",
          type: "Checkbox",
          companyId: f.companyId,
          createdBy: USER
        }
      ])
      .returning("id")
      .execute();
    await trx
      .insertInto("jobOperationStepRecord")
      .values([
        {
          jobOperationStepId: steps[0].id,
          index: 0,
          value: filePath,
          companyId: f.companyId,
          createdBy: USER
        },
        // The same kind of value on a step that is not a File step.
        {
          jobOperationStepId: steps[1].id,
          index: 0,
          value: checkboxPath,
          companyId: f.companyId,
          createdBy: USER
        }
      ])
      .execute();

    for (const [key, status] of [
      ["draft", "Draft"],
      ["approval", "Needs Approval"],
      ["cancelled", "Cancelled"],
      ["open", "In Progress"]
    ] as const) {
      const salesOrderId = `${f.prefix}-so-${key}`;
      await trx
        .insertInto("salesOrder")
        .values({
          id: salesOrderId,
          salesOrderId: `${f.prefix}-${key.toUpperCase()}`,
          customerId: f.customerId,
          status,
          currencyCode: "USD",
          exchangeRate: 1,
          locationId: f.locationId,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .insertInto("salesOrderLine")
        .values({
          salesOrderId,
          salesOrderLineType: "Part",
          itemId: f.partId,
          saleQuantity: 1,
          unitPrice: 10,
          methodType: "Pull from Inventory",
          unitOfMeasureCode: "EA",
          locationId: f.locationId,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
    }

    await trx
      .insertInto("externalLink")
      .values({
        id: portalId,
        documentType: "Customer",
        documentId: f.customerId,
        customerId: f.customerId,
        companyId: f.companyId
      })
      .execute();
  });
}, 120_000);

afterAll(async () => {
  if (!hasLocalDatabase) return;
  await other.cleanup();
  await f.cleanup();
}, 120_000);

async function setPortal(values: { expiresAt: string | null }) {
  await f.db
    .updateTable("externalLink")
    .set(values)
    .where("id", "=", portalId)
    .where("companyId", "=", f.companyId)
    .execute();
}

describe("getJobOperationFileRecord", () => {
  postgrestTest(
    "finds a file recorded on a File step of the operation",
    async (client) => {
      const result = await getJobOperationFileRecord(
        client,
        f.companyId,
        operationId,
        filePath
      );
      expect(result.error).toBeNull();
      expect(result.data?.id).toEqual(expect.any(String));
    }
  );

  postgrestTest(
    "finds nothing for a value on a step that is not a File step",
    async (client) => {
      const result = await getJobOperationFileRecord(
        client,
        f.companyId,
        operationId,
        checkboxPath
      );
      expect(result).toMatchObject({ data: null, error: null });
    }
  );

  postgrestTest(
    "finds nothing for the file under another operation or another company",
    async (client) => {
      const wrongOperation = await getJobOperationFileRecord(
        client,
        f.companyId,
        otherOperationId,
        filePath
      );
      expect(wrongOperation).toMatchObject({ data: null, error: null });
      const wrongCompany = await getJobOperationFileRecord(
        client,
        other.companyId,
        operationId,
        filePath
      );
      expect(wrongCompany).toMatchObject({ data: null, error: null });
    }
  );
});

describe("getExternalSalesOrderLines", () => {
  const statuses = async (
    client: Parameters<typeof getExternalSalesOrderLines>[0],
    hiddenStatuses?: ("Draft" | "Needs Approval" | "Cancelled")[]
  ) => {
    const result = await getExternalSalesOrderLines(client, f.customerId, {
      search: null,
      limit: 50,
      offset: 0,
      sorts: [],
      filters: [],
      hiddenStatuses
    });
    expect(result.error).toBeNull();
    return (result.data ?? []).map((line) => line.salesOrderStatus).sort();
  };

  postgrestTest(
    "leaves out the statuses the portal hides, and only those",
    async (client) => {
      expect(await statuses(client)).toEqual([
        "Cancelled",
        "Draft",
        "In Progress",
        "Needs Approval"
      ]);
      expect(
        await statuses(client, ["Draft", "Needs Approval", "Cancelled"])
      ).toEqual(["In Progress"]);
    }
  );
});

describe("getActiveCustomerPortal", () => {
  postgrestTest(
    "serves an open portal",
    async (client) => {
      await setPortal({ expiresAt: null });
      const result = await getActiveCustomerPortal(client, portalId);
      expect(result.refusal).toBeUndefined();
      expect(result.data?.customerId).toBe(f.customerId);
    }
  );

  postgrestTest("refuses a portal whose expiry has passed", async (client) => {
    await setPortal({ expiresAt: "2020-01-01T00:00:00Z" });
    try {
      expect((await getActiveCustomerPortal(client, portalId)).refusal).toBe(
        "expired"
      );
    } finally {
      await setPortal({ expiresAt: null });
    }
  });

  postgrestTest(
    "answers an unknown link as not found, not as a read failure",
    async (client) => {
      const result = await getActiveCustomerPortal(
        client,
        crypto.randomUUID()
      );
      expect(result.refusal).toBe("notFound");
    }
  );
});
