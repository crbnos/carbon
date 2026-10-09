// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The rental shipment and receipt `create` cases against the live database:
// one Draft per agreement, the units each one holds, and the refusals.

import { sql } from "kysely";
import { expect } from "vitest";
import { databaseTest } from "../local-database-test-fixture";
import { rentalFixture } from "../post-rental-agreement/rental-test-fixture";
import create from "./index";

type Fixture = Awaited<ReturnType<typeof rentalFixture>>;

function deliver(f: Fixture, rentalAgreementLineId?: string) {
  return create(f.ctx, {
    type: "shipmentFromRentalAgreement",
    rentalAgreementId: f.agreementId,
    rentalAgreementLineId
  });
}

function returnUnits(f: Fixture, rentalAgreementLineId?: string) {
  return create(f.ctx, {
    type: "receiptFromRentalAgreement",
    rentalAgreementId: f.agreementId,
    rentalAgreementLineId
  });
}

async function setLineStatus(
  f: Fixture,
  lineIds: string[],
  status: "Pending" | "On Rent" | "Returned"
) {
  await f.db
    .updateTable("rentalAgreementLine")
    .set({ status })
    .where("id", "in", lineIds)
    .where("companyId", "=", f.companyId)
    .execute();
}

function shipmentLines(f: Fixture, shipmentId: string) {
  return f.db
    .selectFrom("shipmentFixedAssetLine")
    .select(["rentalAgreementLineId", "shipped"])
    .where("shipmentId", "=", shipmentId)
    .where("companyId", "=", f.companyId)
    .execute();
}

function receiptLines(f: Fixture, receiptId: string) {
  return f.db
    .selectFrom("receiptFixedAssetLine")
    .select(["rentalAgreementLineId", "received"])
    .where("receiptId", "=", receiptId)
    .where("companyId", "=", f.companyId)
    .execute();
}

databaseTest(
  "a shipment without a line id holds every Pending unit on one Draft",
  async () => {
    const f = await rentalFixture({ units: 5 });
    try {
      const result = await deliver(f);
      expect(result.error).toBeNull();
      const shipment = await f.db
        .selectFrom("shipment")
        .select([
          "status",
          "locationId",
          "sourceDocument",
          "sourceDocumentReadableId",
          sql<string | null>`"postingDate"::text`.as("postingDate")
        ])
        .where("id", "=", result.data!.id)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(shipment).toEqual({
        status: "Draft",
        locationId: f.locationId,
        sourceDocument: "Rental Agreement",
        sourceDocumentReadableId: "RA-TEST",
        postingDate: null
      });
      const lines = await shipmentLines(f, result.data!.id);
      expect(lines).toHaveLength(5);
      expect(lines.every((line) => line.shipped)).toBe(true);
      expect(new Set(lines.map((line) => line.rentalAgreementLineId))).toEqual(
        new Set(f.lineIds)
      );
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a second shipment without a line id opens the same Draft",
  async () => {
    const f = await rentalFixture({ units: 5 });
    try {
      const first = await deliver(f);
      const second = await deliver(f);
      expect(second.error).toBeNull();
      expect(second.data!.id).toEqual(first.data!.id);
      expect(await shipmentLines(f, first.data!.id)).toHaveLength(5);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "the database refuses a second Draft shipment for one agreement",
  async () => {
    const f = await rentalFixture({ units: 5 });
    try {
      const first = await deliver(f);
      expect(first.error).toBeNull();
      await expect(
        f.db
          .insertInto("shipment")
          .values({
            shipmentId: "SHP-DUPLICATE",
            sourceDocument: "Rental Agreement",
            sourceDocumentId: f.agreementId,
            sourceDocumentReadableId: f.agreementReadableId,
            locationId: f.locationId,
            status: "Draft",
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute()
      ).rejects.toThrow("shipment_oneOpenDraftPerRentalAgreement_idx");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest("a receipt with every unit Returned is refused", async () => {
  const f = await rentalFixture({ units: 5 });
  try {
    await setLineStatus(f, f.lineIds, "Returned");
    const result = await returnUnits(f);
    expect(result.error?.message).toContain("No units to return");
  } finally {
    await f.cleanup();
  }
});

databaseTest(
  "a receipt without a line id ticks the On Rent units and holds the Pending ones unticked",
  async () => {
    const f = await rentalFixture({ units: 5 });
    try {
      const onRent = f.lineIds.slice(0, 3);
      await setLineStatus(f, onRent, "On Rent");
      const result = await returnUnits(f);
      expect(result.error).toBeNull();
      const lines = await receiptLines(f, result.data!.id);
      expect(lines).toHaveLength(5);
      const received = lines
        .filter((line) => line.received)
        .map((line) => line.rentalAgreementLineId);
      expect(new Set(received)).toEqual(new Set(onRent));
      expect(lines.filter((line) => !line.received)).toHaveLength(2);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a receipt shortcut for an unticked Pending unit ticks it on the same Draft",
  async () => {
    const f = await rentalFixture({ units: 5 });
    try {
      await setLineStatus(f, f.lineIds.slice(0, 3), "On Rent");
      const first = await returnUnits(f);
      expect(first.error).toBeNull();
      const pendingLineId = f.lineIds[4]!;

      const shortcut = await returnUnits(f, pendingLineId);
      expect(shortcut.error).toBeNull();
      expect(shortcut.data!.id).toEqual(first.data!.id);
      const lines = await receiptLines(f, first.data!.id);
      expect(lines).toHaveLength(5);
      expect(
        lines.find((line) => line.rentalAgreementLineId === pendingLineId)
          ?.received
      ).toBe(true);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest("a shipment holds only the Pending units", async () => {
  const f = await rentalFixture({ units: 5 });
  try {
    const first = await deliver(f);
    expect(first.error).toBeNull();
    await setLineStatus(f, f.lineIds.slice(0, 2), "On Rent");
    await f.db
      .deleteFrom("shipment")
      .where("id", "=", first.data!.id)
      .where("companyId", "=", f.companyId)
      .execute();

    const result = await deliver(f);
    expect(result.error).toBeNull();
    const lines = await shipmentLines(f, result.data!.id);
    expect(new Set(lines.map((line) => line.rentalAgreementLineId))).toEqual(
      new Set(f.lineIds.slice(2))
    );
  } finally {
    await f.cleanup();
  }
});

databaseTest("a Closed agreement delivers nothing", async () => {
  const f = await rentalFixture({ units: 5 });
  try {
    await f.db
      .updateTable("rentalAgreement")
      .set({ status: "Closed" })
      .where("id", "=", f.agreementId)
      .where("companyId", "=", f.companyId)
      .execute();
    const result = await deliver(f);
    expect(result.error?.message).toContain("is Closed");
  } finally {
    await f.cleanup();
  }
});

databaseTest(
  "a receipt shortcut with no Draft receipt returns its Pending unit ticked",
  async () => {
    const f = await rentalFixture({ units: 5 });
    try {
      const lineId = f.lineIds[0]!;
      const result = await returnUnits(f, lineId);
      expect(result.error).toBeNull();
      const lines = await receiptLines(f, result.data!.id);
      expect(lines).toEqual([
        { rentalAgreementLineId: lineId, received: true }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);
