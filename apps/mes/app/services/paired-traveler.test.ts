// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import { parseTravelerCode, travelerIssueSerial } from "~/utils/traveler";
import { findTrackedEntityByCode, scanTraveler } from "./traveler.server";
import {
  fakeClient,
  serialOperation,
  serialUnits
} from "./work-unit-test-fixture";

it("resolves only an active, exact pack-out pair sharing the printed serial", async () => {
  const companyId = "company";
  const serial = " SN-123 ";
  const source = {
    id: "built",
    companyId,
    readableId: serial,
    status: "Consumed"
  };
  const output = {
    id: "packed",
    companyId,
    readableId: serial,
    status: "Available"
  };
  const pair = {
    companyId,
    serial,
    sourceId: source.id,
    outputId: output.id,
    releasedAt: null
  };
  const tables = { trackedEntity: [source, output], jobUnitPairing: [pair] };
  const scan = (rows: Parameters<typeof fakeClient>[0], code = serial) =>
    findTrackedEntityByCode(fakeClient(rows).client, { companyId, code });
  expect(await scan(tables)).toEqual({ kind: "found", entity: output });
  expect(await scan(tables, source.id)).toEqual({
    kind: "found",
    entity: source
  });
  expect(await scan(tables, serial.trim())).toEqual({ kind: "notFound" });
  expect(
    await scan({
      ...tables,
      jobUnitPairing: [{ ...pair, releasedAt: "yesterday" }]
    })
  ).toEqual({ kind: "ambiguous" });
  expect(
    await scan({
      ...tables,
      trackedEntity: [...tables.trackedEntity, { ...source, id: "another" }]
    })
  ).toEqual({ kind: "ambiguous" });
});

it("an ID-only QR observed before a renumber does not confirm the new printed serial", async () => {
  const qr = "https://labels.test/x/traveler/built";
  const companyId = "company";
  const stock = { companyId, id: "built", readableId: "NEW" };
  const result = await findTrackedEntityByCode(
    fakeClient({ trackedEntity: [stock] }).client,
    {
      companyId,
      code: parseTravelerCode(qr)!
    }
  );
  if (result.kind !== "found")
    throw new Error("Expected the same physical unit");
  expect(travelerIssueSerial(qr, result.entity)).toBeUndefined();
  expect(travelerIssueSerial(stock.id, result.entity)).toBeUndefined();
  expect(travelerIssueSerial(qr, result.entity, "OLD")).toBe("OLD");
  expect(travelerIssueSerial("NEW", result.entity)).toBe("NEW");
});

it("delays an ID-only pack-out claim and refuses a stale chooser submission", async () => {
  const companyId = "co";
  const operation = serialOperation({
    id: "pack",
    jobMakeMethodId: "method",
    later: true,
    extra: { job: { locationId: "floor" } }
  });
  const args = {
    companyId,
    locationId: "floor",
    userId: "user",
    employeeId: null,
    trackedEntityId: "built",
    at: { operationId: operation.id, trackedEntityId: "output" }
  };
  const fake = fakeClient(
    {
      jobOperation: [operation],
      jobMakeMethod: [
        { id: "method", companyId, requiresSerialTracking: true }
      ],
      jobMaterial: [
        {
          id: "component",
          companyId,
          itemId: "part",
          jobMakeMethodId: "method",
          jobOperationId: "pack",
          quantity: 1,
          estimatedQuantity: 1,
          quantityIssued: 0
        }
      ],
      trackedEntity: [
        {
          id: "built",
          companyId,
          itemId: "part",
          status: "Available",
          readableId: "NEW",
          item: { itemTrackingType: "Serial" }
        },
        ...serialUnits("method", "pack", [{ id: "output" }])
      ]
    },
    {
      get_traveler_target: [
        { trackedEntityId: "built", jobMakeMethodId: null }
      ],
      get_active_job_operations_by_location: [operation],
      job_requires_serial_pairing: true
    }
  );
  const qr = await scanTraveler(fake.client, args);
  expect(qr).toMatchObject({
    resolution: { kind: "claim", unit: { id: "built", readableId: "NEW" } },
    claimed: null,
    error: null
  });
  const stale = await scanTraveler(fake.client, {
    ...args,
    confirmedChoice: true,
    expectedSerial: "OLD"
  });
  expect(stale).toMatchObject({
    resolution: null,
    claimed: null,
    error: expect.stringContaining("changed")
  });
  expect(fake.writes()).toEqual([]);
});
