import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import {
  activationThrough,
  cancelBlocker,
  closeBlocker,
  FleetUnit,
  futureReturnError,
  payloadValidator,
  rateLadderError,
  toRate,
  unitAvailabilityError,
} from "./validators.ts";

const scope = {
  companyId: "company_1",
  userId: "user_1",
  rentalAgreementId: "rag_1",
};

Deno.test("activate, close and cancel need only the agreement", () => {
  for (const type of ["activate", "close", "cancel"] as const) {
    assertEquals(payloadValidator.parse({ type, ...scope }).type, type);
    assertThrows(() =>
      payloadValidator.parse({
        type,
        companyId: "company_1",
        userId: "user_1",
      })
    );
  }
});

Deno.test("return needs the line and a YYYY-MM-DD return date", () => {
  const parsed = payloadValidator.parse({
    type: "return",
    rentalAgreementLineId: "ragl_1",
    returnedAt: "2026-10-14",
    ...scope,
  });
  if (parsed.type !== "return") throw new Error("wrong variant");
  assertEquals(parsed.returnedAt, "2026-10-14");
  assertEquals(parsed.meterIn, undefined);
  assertEquals(parsed.takeOutOfService, undefined);

  assertThrows(() =>
    payloadValidator.parse({ type: "return", returnedAt: "2026-10-14", ...scope })
  );
  assertThrows(() =>
    payloadValidator.parse({
      type: "return",
      rentalAgreementLineId: "ragl_1",
      returnedAt: "2026-10-14T00:00:00.000Z",
      ...scope,
    })
  );
});

Deno.test("return carries the meter, notes and the out-of-service reason", () => {
  const parsed = payloadValidator.parse({
    type: "return",
    rentalAgreementLineId: "ragl_1",
    returnedAt: "2026-10-14",
    meterIn: 1250.5,
    returnNotes: "Scratched boom",
    takeOutOfService: true,
    outOfServiceReason: "Hydraulic leak",
    ...scope,
  });
  if (parsed.type !== "return") throw new Error("wrong variant");
  assertEquals(parsed.meterIn, 1250.5);
  assertEquals(parsed.outOfServiceReason, "Hydraulic leak");
});

Deno.test("taking a unit out of service at return needs a reason", () => {
  for (const outOfServiceReason of [undefined, null, "", "   "]) {
    assertThrows(() =>
      payloadValidator.parse({
        type: "return",
        rentalAgreementLineId: "ragl_1",
        returnedAt: "2026-10-14",
        takeOutOfService: true,
        outOfServiceReason,
        ...scope,
      })
    );
  }
  assertEquals(
    payloadValidator.parse({
      type: "return",
      rentalAgreementLineId: "ragl_1",
      returnedAt: "2026-10-14",
      takeOutOfService: false,
      ...scope,
    }).type,
    "return",
  );
});

Deno.test("a negative meter reading and an unknown type are refused", () => {
  assertThrows(() =>
    payloadValidator.parse({
      type: "return",
      rentalAgreementLineId: "ragl_1",
      returnedAt: "2026-10-14",
      meterIn: -1,
      ...scope,
    })
  );
  assertThrows(() => payloadValidator.parse({ type: "deliver", ...scope }));
});

Deno.test("activation generates through one cycle past today", () => {
  assertEquals(activationThrough("Calendar Month", "2026-09-22"), "2026-10-31");
  assertEquals(activationThrough("Calendar Month", "2026-12-31"), "2027-01-31");
  assertEquals(activationThrough("Calendar Month", "2027-01-31"), "2027-02-28");
  assertEquals(activationThrough("28 Days", "2026-09-22"), "2026-10-20");
  assertEquals(activationThrough("28 Days", "2026-12-20"), "2027-01-17");
});

const ladder = (
  dayRate: number | null,
  weekRate: number | null,
  monthRate: number | null,
) => ({ dayRate, weekRate, monthRate });

Deno.test("a Calendar Month agreement needs the month tier", () => {
  assertStringIncludes(
    rateLadderError({
      cycle: "Calendar Month",
      rateMode: "Best Rate",
      rateUnit: null,
      rates: ladder(100, 500, null),
    }) ?? "",
    "month rate",
  );
  assertEquals(
    rateLadderError({
      cycle: "Calendar Month",
      rateMode: "Best Rate",
      rateUnit: null,
      rates: ladder(null, null, 1500),
    }),
    null,
  );
});

Deno.test("a 28 Days agreement needs at least one tier", () => {
  assertStringIncludes(
    rateLadderError({
      cycle: "28 Days",
      rateMode: "Best Rate",
      rateUnit: null,
      rates: ladder(null, null, null),
    }) ?? "",
    "at least one",
  );
  assertEquals(
    rateLadderError({
      cycle: "28 Days",
      rateMode: "Best Rate",
      rateUnit: null,
      rates: ladder(100, null, null),
    }),
    null,
  );
});

Deno.test("a Fixed line needs the tier it bills", () => {
  assertStringIncludes(
    rateLadderError({
      cycle: "28 Days",
      rateMode: "Fixed",
      rateUnit: "Week",
      rates: ladder(100, null, 1500),
    }) ?? "",
    "week rate",
  );
  assertStringIncludes(
    rateLadderError({
      cycle: "28 Days",
      rateMode: "Fixed",
      rateUnit: null,
      rates: ladder(100, 500, 1500),
    }) ?? "",
    "no rate unit",
  );
  assertEquals(
    rateLadderError({
      cycle: "28 Days",
      rateMode: "Fixed",
      rateUnit: "Day",
      rates: ladder(100, null, null),
    }),
    null,
  );
});

Deno.test("NUMERIC rates decode to numbers and null stays null", () => {
  assertEquals(toRate(null), null);
  assertEquals(toRate(undefined), null);
  assertEquals(toRate("125.5"), 125.5);
  assertEquals(toRate(0), 0);
});

const unit = (overrides: Partial<FleetUnit>): FleetUnit => ({
  fixedAssetId: "FA000012",
  status: "Active",
  fleetStatus: "Available",
  outOfServiceReason: null,
  liveAgreementId: null,
  liveAgreementReadableId: null,
  ...overrides,
});

Deno.test("an Available, in-service unit can go on rent", () => {
  assertEquals(unitAvailabilityError(unit({}), "rag_1"), null);
  assertEquals(
    unitAvailabilityError(unit({ status: "Fully Depreciated" }), "rag_1"),
    null,
  );
});

Deno.test("the agreement's own Draft line reserving the unit is not a conflict", () => {
  assertEquals(
    unitAvailabilityError(
      unit({
        fleetStatus: "Reserved",
        liveAgreementId: "rag_1",
        liveAgreementReadableId: "RA000001",
      }),
      "rag_1",
    ),
    null,
  );
});

Deno.test("a unit held by another agreement names that agreement", () => {
  for (const fleetStatus of ["Reserved", "On Rent"]) {
    const message = unitAvailabilityError(
      unit({
        fleetStatus,
        liveAgreementId: "rag_other",
        liveAgreementReadableId: "RA000007",
      }),
      "rag_1",
    );
    assertStringIncludes(message ?? "", "RA000007");
    assertStringIncludes(message ?? "", fleetStatus);
  }
  // On Rent under this very agreement is not a Draft reservation.
  assertStringIncludes(
    unitAvailabilityError(
      unit({
        fleetStatus: "On Rent",
        liveAgreementId: "rag_1",
        liveAgreementReadableId: "RA000001",
      }),
      "rag_1",
    ) ?? "",
    "On Rent",
  );
});

Deno.test("an out-of-service unit names the reason", () => {
  const message = unitAvailabilityError(
    unit({
      fleetStatus: "In Maintenance",
      outOfServiceReason: "Hydraulic leak",
      liveAgreementId: "rag_1",
    }),
    "rag_1",
  );
  assertStringIncludes(message ?? "", "Hydraulic leak");
});

Deno.test("sold, returned-to-stock, under-construction and draft units are refused", () => {
  for (const fleetStatus of ["Sold", "Returned to Stock", "Under Construction"]) {
    assertStringIncludes(
      unitAvailabilityError(unit({ fleetStatus }), "rag_1") ?? "",
      fleetStatus,
    );
  }
  assertStringIncludes(
    unitAvailabilityError(unit({ status: "Draft" }), "rag_1") ?? "",
    "Draft",
  );
});

Deno.test("close needs every unit back and everything billed", () => {
  assertEquals(
    closeBlocker({
      lineStatuses: ["Returned", "Sold"],
      pendingPeriods: 0,
      unbilledCharges: 0,
    }),
    null,
  );
  assertStringIncludes(
    closeBlocker({
      lineStatuses: ["Returned", "On Rent"],
      pendingPeriods: 0,
      unbilledCharges: 0,
    }) ?? "",
    "returned or sold",
  );
  assertStringIncludes(
    closeBlocker({
      lineStatuses: ["Returned", "Pending"],
      pendingPeriods: 0,
      unbilledCharges: 0,
    }) ?? "",
    "returned or sold",
  );
  assertStringIncludes(
    closeBlocker({
      lineStatuses: ["Returned"],
      pendingPeriods: 1,
      unbilledCharges: 0,
    }) ?? "",
    "billing period",
  );
  assertStringIncludes(
    closeBlocker({
      lineStatuses: ["Returned"],
      pendingPeriods: 0,
      unbilledCharges: 2,
    }) ?? "",
    "charge",
  );
});

Deno.test("a Draft always cancels; an Active one only before delivery and billing", () => {
  assertEquals(
    cancelBlocker({
      status: "Draft",
      lineStatuses: ["Pending"],
      invoicedPeriods: 0,
      billedCharges: 0,
      recognizedRows: 0,
      commencedSalesTypeLines: 0,
    }),
    null,
  );
  assertEquals(
    cancelBlocker({
      status: "Active",
      lineStatuses: ["Pending", "Returned"],
      invoicedPeriods: 0,
      billedCharges: 0,
      recognizedRows: 0,
      commencedSalesTypeLines: 0,
    }),
    null,
  );
  assertStringIncludes(
    cancelBlocker({
      status: "Active",
      lineStatuses: ["Pending", "On Rent"],
      invoicedPeriods: 0,
      billedCharges: 0,
      recognizedRows: 0,
      commencedSalesTypeLines: 0,
    }) ?? "",
    "on rent",
  );
  assertStringIncludes(
    cancelBlocker({
      status: "Active",
      lineStatuses: ["Returned"],
      invoicedPeriods: 1,
      billedCharges: 0,
      recognizedRows: 0,
      commencedSalesTypeLines: 0,
    }) ?? "",
    "invoiced",
  );
  assertStringIncludes(
    cancelBlocker({
      status: "Active",
      lineStatuses: ["Returned"],
      invoicedPeriods: 0,
      billedCharges: 1,
      recognizedRows: 0,
      commencedSalesTypeLines: 0,
    }) ?? "",
    "invoiced",
  );
  assertStringIncludes(
    cancelBlocker({
      status: "Closed",
      lineStatuses: ["Returned"],
      invoicedPeriods: 0,
      billedCharges: 0,
      recognizedRows: 0,
      commencedSalesTypeLines: 0,
    }) ?? "",
    "Closed",
  );
  assertStringIncludes(
    cancelBlocker({
      status: "Active",
      lineStatuses: ["Returned"],
      invoicedPeriods: 0,
      billedCharges: 0,
      recognizedRows: 1,
      commencedSalesTypeLines: 0,
    }) ?? "",
    "recognized",
  );
});

Deno.test("a commenced sales-type line cannot be cancelled: early termination is a manual journal", () => {
  // Checked before the interest rows the commencement wrote would trip the
  // generic "recognized" message.
  assertEquals(
    cancelBlocker({
      status: "Active",
      lineStatuses: ["Pending"],
      invoicedPeriods: 0,
      billedCharges: 0,
      recognizedRows: 36,
      commencedSalesTypeLines: 1,
    }),
    "Early termination of a sales-type lease is a manual journal",
  );
  // A Draft has commenced nothing.
  assertEquals(
    cancelBlocker({
      status: "Draft",
      lineStatuses: ["Pending"],
      invoicedPeriods: 0,
      billedCharges: 0,
      recognizedRows: 0,
      commencedSalesTypeLines: 0,
    }),
    null,
  );
});

Deno.test("return accepts a residual destination of Fleet or Inventory, or none", () => {
  const base = {
    type: "return",
    rentalAgreementLineId: "ragl_1",
    returnedAt: "2029-12-31",
    ...scope,
  };
  for (const residualDestination of ["Fleet", "Inventory"] as const) {
    const parsed = payloadValidator.parse({ ...base, residualDestination });
    assertEquals(
      parsed.type === "return" ? parsed.residualDestination : undefined,
      residualDestination,
    );
  }
  const none = payloadValidator.parse(base);
  assertEquals(
    none.type === "return" ? none.residualDestination : "unset",
    undefined,
  );
  assertThrows(() =>
    payloadValidator.parse({ ...base, residualDestination: "Scrap" })
  );
});

Deno.test("a return is never dated after the company's today", () => {
  assertEquals(futureReturnError("2027-03-01", "2027-03-01"), null);
  assertEquals(futureReturnError("2027-02-28", "2027-03-01"), null);
  assertEquals(
    futureReturnError("2027-03-02", "2027-03-01"),
    "The return date cannot be in the future",
  );
  // Across a year boundary, compared as dates rather than numbers.
  assertEquals(
    futureReturnError("2028-01-01", "2027-12-31"),
    "The return date cannot be in the future",
  );
});
