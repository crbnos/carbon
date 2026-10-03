// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";

import {
  activationThrough,
  cancelBlocker,
  closeBlocker,
  type FleetUnit,
  futureReturnError,
  payloadValidator,
  toRate,
  unitAvailabilityError
} from "./validators";

const scope = {
  rentalAgreementId: "rag_1"
};

it("activate, close and cancel need only the agreement", () => {
  for (const type of ["activate", "close", "cancel"] as const) {
    expect(payloadValidator.parse({ type, ...scope }).type).toEqual(type);
    expect(() =>
      payloadValidator.parse({
        type
      })
    ).toThrow();
  }
});

it("return needs the line and a YYYY-MM-DD return date", () => {
  const parsed = payloadValidator.parse({
    type: "return",
    rentalAgreementLineId: "ragl_1",
    returnedAt: "2026-10-14",
    ...scope
  });
  if (parsed.type !== "return") throw new Error("wrong variant");
  expect(parsed.returnedAt).toEqual("2026-10-14");
  expect(parsed.meterIn).toEqual(undefined);
  expect(parsed.takeOutOfService).toEqual(undefined);

  expect(() =>
    payloadValidator.parse({
      type: "return",
      returnedAt: "2026-10-14",
      ...scope
    })
  ).toThrow();
  expect(() =>
    payloadValidator.parse({
      type: "return",
      rentalAgreementLineId: "ragl_1",
      returnedAt: "2026-10-14T00:00:00.000Z",
      ...scope
    })
  ).toThrow();
});

it("return carries the meter, notes and the out-of-service reason", () => {
  const parsed = payloadValidator.parse({
    type: "return",
    rentalAgreementLineId: "ragl_1",
    returnedAt: "2026-10-14",
    meterIn: 1250.5,
    returnNotes: "Scratched boom",
    takeOutOfService: true,
    outOfServiceReason: "Hydraulic leak",
    ...scope
  });
  if (parsed.type !== "return") throw new Error("wrong variant");
  expect(parsed.meterIn).toEqual(1250.5);
  expect(parsed.outOfServiceReason).toEqual("Hydraulic leak");
});

it("taking a unit out of service at return needs a reason", () => {
  for (const outOfServiceReason of [undefined, null, "", "   "]) {
    expect(() =>
      payloadValidator.parse({
        type: "return",
        rentalAgreementLineId: "ragl_1",
        returnedAt: "2026-10-14",
        takeOutOfService: true,
        outOfServiceReason,
        ...scope
      })
    ).toThrow();
  }
  expect(
    payloadValidator.parse({
      type: "return",
      rentalAgreementLineId: "ragl_1",
      returnedAt: "2026-10-14",
      takeOutOfService: false,
      ...scope
    }).type
  ).toEqual("return");
});

it("a negative meter reading and an unknown type are refused", () => {
  expect(() =>
    payloadValidator.parse({
      type: "return",
      rentalAgreementLineId: "ragl_1",
      returnedAt: "2026-10-14",
      meterIn: -1,
      ...scope
    })
  ).toThrow();
  expect(() => payloadValidator.parse({ type: "deliver", ...scope })).toThrow();
});

it("activation generates through one cycle past today", () => {
  expect(activationThrough("Calendar Month", "2026-09-22")).toEqual(
    "2026-10-31"
  );
  expect(activationThrough("Calendar Month", "2026-12-31")).toEqual(
    "2027-01-31"
  );
  expect(activationThrough("Calendar Month", "2027-01-31")).toEqual(
    "2027-02-28"
  );
  expect(activationThrough("28 Days", "2026-09-22")).toEqual("2026-10-20");
  expect(activationThrough("28 Days", "2026-12-20")).toEqual("2027-01-17");
});

it("NUMERIC rates decode to numbers and null stays null", () => {
  expect(toRate(null)).toEqual(null);
  expect(toRate(undefined)).toEqual(null);
  expect(toRate("125.5")).toEqual(125.5);
  expect(toRate(0)).toEqual(0);
});

const unit = (overrides: Partial<FleetUnit>): FleetUnit => ({
  fixedAssetId: "FA000012",
  status: "Active",
  fleetStatus: "Available",
  outOfServiceReason: null,
  liveAgreementId: null,
  liveAgreementReadableId: null,
  ...overrides
});

it("an Available, in-service unit can go on rent", () => {
  expect(unitAvailabilityError(unit({}), "rag_1")).toEqual(null);
  expect(
    unitAvailabilityError(unit({ status: "Fully Depreciated" }), "rag_1")
  ).toEqual(null);
});

it("the agreement's own Draft line reserving the unit is not a conflict", () => {
  expect(
    unitAvailabilityError(
      unit({
        fleetStatus: "Reserved",
        liveAgreementId: "rag_1",
        liveAgreementReadableId: "RA000001"
      }),
      "rag_1"
    )
  ).toEqual(null);
});

it("a unit held by another agreement names that agreement", () => {
  for (const fleetStatus of ["Reserved", "On Rent"]) {
    const message = unitAvailabilityError(
      unit({
        fleetStatus,
        liveAgreementId: "rag_other",
        liveAgreementReadableId: "RA000007"
      }),
      "rag_1"
    );
    expect(message ?? "").toContain("RA000007");
    expect(message ?? "").toContain(fleetStatus);
  }
  // On Rent under this very agreement is not a Draft reservation.
  expect(
    unitAvailabilityError(
      unit({
        fleetStatus: "On Rent",
        liveAgreementId: "rag_1",
        liveAgreementReadableId: "RA000001"
      }),
      "rag_1"
    ) ?? ""
  ).toContain("On Rent");
});

it("an out-of-service unit names the reason", () => {
  const message = unitAvailabilityError(
    unit({
      fleetStatus: "In Maintenance",
      outOfServiceReason: "Hydraulic leak",
      liveAgreementId: "rag_1"
    }),
    "rag_1"
  );
  expect(message ?? "").toContain("Hydraulic leak");
});

it("sold, returned-to-stock, under-construction and draft units are refused", () => {
  for (const fleetStatus of [
    "Sold",
    "Returned to Stock",
    "Under Construction"
  ]) {
    expect(
      unitAvailabilityError(unit({ fleetStatus }), "rag_1") ?? ""
    ).toContain(fleetStatus);
  }
  expect(
    unitAvailabilityError(unit({ status: "Draft" }), "rag_1") ?? ""
  ).toContain("Draft");
});

it("close needs every unit back and everything billed", () => {
  expect(
    closeBlocker({
      lineStatuses: ["Returned", "Sold"],
      pendingPeriods: 0,
      unbilledCharges: 0
    })
  ).toEqual(null);
  expect(
    closeBlocker({
      lineStatuses: ["Returned", "On Rent"],
      pendingPeriods: 0,
      unbilledCharges: 0
    }) ?? ""
  ).toContain("returned or sold");
  expect(
    closeBlocker({
      lineStatuses: ["Returned", "Pending"],
      pendingPeriods: 0,
      unbilledCharges: 0
    }) ?? ""
  ).toContain("returned or sold");
  expect(
    closeBlocker({
      lineStatuses: ["Returned"],
      pendingPeriods: 1,
      unbilledCharges: 0
    }) ?? ""
  ).toContain("billing period");
  expect(
    closeBlocker({
      lineStatuses: ["Returned"],
      pendingPeriods: 0,
      unbilledCharges: 2
    }) ?? ""
  ).toContain("charge");
});

it("a Draft always cancels; an Active one only before delivery and billing", () => {
  expect(
    cancelBlocker({
      status: "Draft",
      lineStatuses: ["Pending"],
      invoicedPeriods: 0,
      billedCharges: 0,
      recognizedRows: 0,
      commencedSalesTypeLines: 0
    })
  ).toEqual(null);
  expect(
    cancelBlocker({
      status: "Active",
      lineStatuses: ["Pending", "Returned"],
      invoicedPeriods: 0,
      billedCharges: 0,
      recognizedRows: 0,
      commencedSalesTypeLines: 0
    })
  ).toEqual(null);
  expect(
    cancelBlocker({
      status: "Active",
      lineStatuses: ["Pending", "On Rent"],
      invoicedPeriods: 0,
      billedCharges: 0,
      recognizedRows: 0,
      commencedSalesTypeLines: 0
    }) ?? ""
  ).toContain("on rent");
  expect(
    cancelBlocker({
      status: "Active",
      lineStatuses: ["Returned"],
      invoicedPeriods: 1,
      billedCharges: 0,
      recognizedRows: 0,
      commencedSalesTypeLines: 0
    }) ?? ""
  ).toContain("invoiced");
  expect(
    cancelBlocker({
      status: "Active",
      lineStatuses: ["Returned"],
      invoicedPeriods: 0,
      billedCharges: 1,
      recognizedRows: 0,
      commencedSalesTypeLines: 0
    }) ?? ""
  ).toContain("invoiced");
  expect(
    cancelBlocker({
      status: "Closed",
      lineStatuses: ["Returned"],
      invoicedPeriods: 0,
      billedCharges: 0,
      recognizedRows: 0,
      commencedSalesTypeLines: 0
    }) ?? ""
  ).toContain("Closed");
  expect(
    cancelBlocker({
      status: "Active",
      lineStatuses: ["Returned"],
      invoicedPeriods: 0,
      billedCharges: 0,
      recognizedRows: 1,
      commencedSalesTypeLines: 0
    }) ?? ""
  ).toContain("recognized");
});

it("a commenced sales-type line cannot be cancelled: early termination is a manual journal", () => {
  // Checked before the interest rows the commencement wrote would trip the
  // generic "recognized" message.
  expect(
    cancelBlocker({
      status: "Active",
      lineStatuses: ["Pending"],
      invoicedPeriods: 0,
      billedCharges: 0,
      recognizedRows: 36,
      commencedSalesTypeLines: 1
    })
  ).toEqual("Ending a rental treated as a sale early is a manual journal");
  // A Draft has commenced nothing.
  expect(
    cancelBlocker({
      status: "Draft",
      lineStatuses: ["Pending"],
      invoicedPeriods: 0,
      billedCharges: 0,
      recognizedRows: 0,
      commencedSalesTypeLines: 0
    })
  ).toEqual(null);
});

it("return accepts a residual destination of Fleet or Inventory, or none", () => {
  const base = {
    type: "return",
    rentalAgreementLineId: "ragl_1",
    returnedAt: "2029-12-31",
    ...scope
  };
  for (const residualDestination of ["Fleet", "Inventory"] as const) {
    const parsed = payloadValidator.parse({ ...base, residualDestination });
    expect(
      parsed.type === "return" ? parsed.residualDestination : undefined
    ).toEqual(residualDestination);
  }
  const none = payloadValidator.parse(base);
  expect(none.type === "return" ? none.residualDestination : "unset").toEqual(
    undefined
  );
  expect(() =>
    payloadValidator.parse({ ...base, residualDestination: "Scrap" })
  ).toThrow();
});

it("a return is never dated after the company's today", () => {
  expect(futureReturnError("2027-03-01", "2027-03-01")).toEqual(null);
  expect(futureReturnError("2027-02-28", "2027-03-01")).toEqual(null);
  expect(futureReturnError("2027-03-02", "2027-03-01")).toEqual(
    "The return date cannot be in the future"
  );
  // Across a year boundary, compared as dates rather than numbers.
  expect(futureReturnError("2028-01-01", "2027-12-31")).toEqual(
    "The return date cannot be in the future"
  );
});
