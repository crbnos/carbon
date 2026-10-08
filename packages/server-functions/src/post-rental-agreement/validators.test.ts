// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";

import {
  activationThrough,
  cancelBlocker,
  closeBlocker,
  type FleetUnit,
  futureDeliveryError,
  futureReleaseError,
  futureReturnError,
  openRentalDocumentBlocker,
  payloadValidator,
  receiptReturnError,
  releaseBlocker,
  rentalShipmentVoidBlocker,
  toRate,
  unitAvailabilityError,
  unitLabel,
  unitReturnValidator,
  unpricedUnitError
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

it("release needs the line and a YYYY-MM-DD date", () => {
  const parsed = payloadValidator.parse({
    type: "release",
    rentalAgreementLineId: "ragl_1",
    returnedAt: "2026-10-14",
    ...scope
  });
  if (parsed.type !== "release") throw new Error("wrong variant");
  expect(parsed.rentalAgreementLineId).toEqual("ragl_1");
  expect(parsed.returnedAt).toEqual("2026-10-14");

  expect(() =>
    payloadValidator.parse({
      type: "release",
      returnedAt: "2026-10-14",
      ...scope
    })
  ).toThrow();
  expect(() =>
    payloadValidator.parse({
      type: "release",
      rentalAgreementLineId: "ragl_1",
      returnedAt: "2026-10-14T00:00:00.000Z",
      ...scope
    })
  ).toThrow();
});

it("release strips a meter reading", () => {
  const parsed = payloadValidator.parse({
    type: "release",
    rentalAgreementLineId: "ragl_1",
    returnedAt: "2026-10-14",
    meterIn: 1250.5,
    ...scope
  });
  expect("meterIn" in parsed).toEqual(false);
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

it("a unit at no rate cannot be activated", () => {
  expect(unpricedUnitError("FA000001", 0)).toEqual(
    "FA000001 has no rate; enter its rate before activating"
  );
  expect(unpricedUnitError("FA000001", Number.NaN)).not.toEqual(null);
  expect(unpricedUnitError("FA000001", 0.01)).toEqual(null);
});

it("a unit return needs the line and a YYYY-MM-DD return date", () => {
  const parsed = unitReturnValidator.parse({
    rentalAgreementLineId: "ragl_1",
    returnedAt: "2026-10-14"
  });
  expect(parsed.returnedAt).toEqual("2026-10-14");
  expect(parsed.meterIn).toEqual(undefined);
  expect(parsed.takeOutOfService).toEqual(undefined);

  expect(() =>
    unitReturnValidator.parse({ returnedAt: "2026-10-14" })
  ).toThrow();
  expect(() =>
    unitReturnValidator.parse({
      rentalAgreementLineId: "ragl_1",
      returnedAt: "2026-10-14T00:00:00.000Z"
    })
  ).toThrow();
});

it("a unit return carries the meter, notes and the out-of-service reason", () => {
  const parsed = unitReturnValidator.parse({
    rentalAgreementLineId: "ragl_1",
    returnedAt: "2026-10-14",
    meterIn: 1250.5,
    returnNotes: "Scratched boom",
    takeOutOfService: true,
    outOfServiceReason: "Hydraulic leak",
    residualDestination: "Fleet"
  });
  expect(parsed.meterIn).toEqual(1250.5);
  expect(parsed.outOfServiceReason).toEqual("Hydraulic leak");
  expect(parsed.residualDestination).toEqual("Fleet");
});

it("taking a unit out of service on a unit return needs a reason", () => {
  for (const outOfServiceReason of [undefined, null, "", "   "]) {
    expect(() =>
      unitReturnValidator.parse({
        rentalAgreementLineId: "ragl_1",
        returnedAt: "2026-10-14",
        takeOutOfService: true,
        outOfServiceReason
      })
    ).toThrow();
  }
  expect(
    unitReturnValidator.parse({
      rentalAgreementLineId: "ragl_1",
      returnedAt: "2026-10-14",
      takeOutOfService: false
    }).takeOutOfService
  ).toEqual(false);
});

it("a unit is named by its asset number, else its asset name, else its line", () => {
  expect(unitLabel({ fixedAssetId: "FA-1", name: "Lift" }, "ragl_1")).toEqual(
    "FA-1"
  );
  expect(unitLabel({ fixedAssetId: null, name: "Lift" }, "ragl_1")).toEqual(
    "Lift"
  );
  expect(unitLabel(undefined, "ragl_1")).toEqual("ragl_1");
});

it("a delivery is never dated after today", () => {
  expect(futureDeliveryError("2026-10-15", "2026-10-14")).toEqual(
    "The delivery date cannot be in the future"
  );
  expect(futureDeliveryError("2026-10-14", "2026-10-14")).toBeNull();
});

it("a release is never dated after today", () => {
  expect(futureReleaseError("2026-10-15", "2026-10-14")).toEqual(
    "The release date cannot be in the future"
  );
  expect(futureReleaseError("2026-10-14", "2026-10-14")).toBeNull();
});

it("a rental shipment voids only while every unit is On Rent", () => {
  expect(
    rentalShipmentVoidBlocker([
      { label: "FA-1", status: "On Rent", accrual: "Posted" },
      { label: "FA-2", status: "Returned", accrual: null }
    ])
  ).toEqual(
    "FA-2 is Returned; a rental shipment can be voided only while every unit is On Rent"
  );
});

it("a rental shipment does not void over a posted accrual", () => {
  expect(
    rentalShipmentVoidBlocker([
      { label: "FA-1", status: "On Rent", accrual: null },
      { label: "FA-2", status: "On Rent", accrual: "Posted" }
    ])
  ).toEqual(
    "A posted revenue recognition run holds accrued rent for FA-2; the shipment cannot be voided"
  );
});

it("a rental shipment does not void over a draft run's accrual", () => {
  expect(
    rentalShipmentVoidBlocker([
      { label: "FA-1", status: "On Rent", accrual: "Draft run" },
      { label: "FA-2", status: "On Rent", accrual: "Posted" }
    ])
  ).toEqual(
    "A draft revenue recognition run holds accrued rent for FA-1; delete the run before voiding the shipment"
  );
});

it("a rental shipment with every unit On Rent and no accrual voids", () => {
  expect(
    rentalShipmentVoidBlocker([
      { label: "FA-1", status: "On Rent", accrual: null },
      { label: "FA-2", status: "On Rent", accrual: null }
    ])
  ).toBeNull();
});

it("an open rental shipment blocks the close first", () => {
  expect(
    openRentalDocumentBlocker({
      shipmentId: "SHP-000004",
      receiptId: "RCV-000002"
    })
  ).toEqual(
    "Shipment SHP-000004 is still open; post or delete it before closing the agreement"
  );
});

it("an open rental receipt blocks the close", () => {
  expect(
    openRentalDocumentBlocker({ shipmentId: null, receiptId: "RCV-000002" })
  ).toEqual(
    "Receipt RCV-000002 is still open; post or delete it before closing the agreement"
  );
});

it("no open rental document leaves the close alone", () => {
  expect(
    openRentalDocumentBlocker({ shipmentId: null, receiptId: null })
  ).toBeNull();
});

it("a rental receipt returns a Pending or On Rent unit only", () => {
  expect(receiptReturnError("FA-1", "Returned")).toEqual(
    "FA-1 is Returned; only a Pending or On Rent unit can be returned"
  );
  expect(receiptReturnError("FA-1", "Pending")).toBeNull();
  expect(receiptReturnError("FA-1", "On Rent")).toBeNull();
});

it("only a Pending unit can be released", () => {
  expect(
    releaseBlocker({
      label: "FA-1",
      status: "On Rent",
      classification: "Sale",
      openDocument: "shipment SHP-000004"
    })
  ).toEqual("FA-1 is On Rent; only a Pending unit can be released");
});

it("a unit treated as a sale is not released", () => {
  expect(
    releaseBlocker({
      label: "FA-1",
      status: "Pending",
      classification: "Sale",
      openDocument: "shipment SHP-000004"
    })
  ).toEqual("FA-1 is treated as a sale; return it on a rental receipt instead");
});

it("a unit on an open rental document is not released", () => {
  expect(
    releaseBlocker({
      label: "FA-1",
      status: "Pending",
      classification: "Rental",
      openDocument: "receipt RCV-000002"
    })
  ).toEqual(
    "FA-1 is on receipt RCV-000002; remove it there before releasing the unit"
  );
});

it("a Pending rental unit on no open document is released", () => {
  expect(
    releaseBlocker({
      label: "FA-1",
      status: "Pending",
      classification: null,
      openDocument: null
    })
  ).toBeNull();
});
