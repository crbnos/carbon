// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Releasing a Pending rental unit against the live database: the unit never
// left the yard, so its billing stops at the release date and it is free
// again, with no document. Refused for a unit that is not Pending, one treated
// as a sale, one on an open rental document, and a future date.

import { datetime } from "@carbon/utils";
import { sql } from "kysely";
import { expect } from "vitest";
import create from "../create";
import { databaseTest } from "../local-database-test-fixture";
import postRentalAgreement from "./index";
import { rentalFixture } from "./rental-test-fixture";

type Fixture = Awaited<ReturnType<typeof rentalFixture>>;

// The fixture company's timezone.
const TIME_ZONE = "America/New_York";

function release(f: Fixture, returnedAt: string) {
  return postRentalAgreement(f.ctx, {
    type: "release",
    rentalAgreementId: f.agreementId,
    rentalAgreementLineId: f.lineIds[0]!,
    returnedAt
  });
}

async function setLine(
  f: Fixture,
  values: { status?: "On Rent"; lessorClassification?: "Sale" }
) {
  await f.db
    .updateTable("rentalAgreementLine")
    .set(values)
    .where("id", "=", f.lineIds[0]!)
    .where("companyId", "=", f.companyId)
    .execute();
}

databaseTest(
  "a released Pending unit stops billing and is free again",
  async () => {
    const f = await rentalFixture();
    const lineId = f.lineIds[0]!;
    try {
      const result = await release(f, "2026-09-20");
      expect(result.error).toBeNull();

      const line = await f.db
        .selectFrom("rentalAgreementLine")
        .select([
          "status",
          sql<string | null>`"returnedAt"::text`.as("returnedAt")
        ])
        .where("id", "=", lineId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(line).toEqual({ status: "Returned", returnedAt: "2026-09-20" });

      const periods = await f.db
        .selectFrom("rentalBillingPeriod")
        .select([
          sql<string>`"periodStart"::text`.as("periodStart"),
          "status",
          "isAdjustment"
        ])
        .where("rentalAgreementLineId", "=", lineId)
        .where("companyId", "=", f.companyId)
        .execute();
      expect(
        periods.filter(
          (period) =>
            period.status === "Pending" && period.periodStart > "2026-09-20"
        )
      ).toEqual([]);
      expect(periods.filter((period) => period.isAdjustment)).toHaveLength(1);

      const fleet = await f.db
        .selectFrom("fleetAssets")
        .select("fleetStatus")
        .where("id", "=", f.fixedAssetIds[0]!)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(fleet.fleetStatus).toEqual("Available");

      const asset = await f.db
        .selectFrom("fixedAsset")
        .select("locationId")
        .where("id", "=", f.fixedAssetIds[0]!)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(asset.locationId).toEqual(f.locationId);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest("an On Rent unit is not released", async () => {
  const f = await rentalFixture();
  try {
    await setLine(f, { status: "On Rent" });
    const result = await release(f, "2026-09-20");
    expect(result.error?.message).toContain(
      "is On Rent; only a Pending unit can be released"
    );
  } finally {
    await f.cleanup();
  }
});

databaseTest("a release is never dated after today", async () => {
  const f = await rentalFixture();
  try {
    const tomorrow = datetime.today(TIME_ZONE).add({ days: 1 }).toString();
    const result = await release(f, tomorrow);
    expect(result.error?.message).toContain(
      "The release date cannot be in the future"
    );
  } finally {
    await f.cleanup();
  }
});

databaseTest("a unit treated as a sale is not released", async () => {
  const f = await rentalFixture();
  try {
    await setLine(f, { lessorClassification: "Sale" });
    const result = await release(f, "2026-09-20");
    expect(result.error?.message).toContain(
      "is treated as a sale; return it on a rental receipt instead"
    );
  } finally {
    await f.cleanup();
  }
});

databaseTest("a unit on an open rental shipment is not released", async () => {
  const f = await rentalFixture();
  try {
    const shipment = await create(f.ctx, {
      type: "shipmentFromRentalAgreement",
      rentalAgreementId: f.agreementId
    });
    expect(shipment.error).toBeNull();

    const result = await release(f, "2026-09-20");
    expect(result.error?.message).toContain("is on shipment SHP-");
  } finally {
    await f.cleanup();
  }
});
