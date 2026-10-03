// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
// The web's zfd validators are the authority on what a command accepts. The
// API takes JSON where the web takes FormData, so the two schemas differ in
// COERCION but must agree on the resulting values — that is what these type
// assertions pin. Imported by relative path: this is a test, and @carbon/mes-core
// must never depend on the app.
import type {
  baseQuantityValidator,
  inspectionCompletePassedValidator,
  inspectionDispositionValidator,
  inspectionGaugeValidator,
  inspectionMeasurementValidator,
  inspectionSampleValidator,
  issueValidator,
  pickQuantityValidator,
  productionEventValidator,
  scrapQuantityValidator,
  stepRecordValidator
} from "../../../apps/mes/app/services/models";
import {
  type inspectionCompletePassedBody,
  inspectionDispositionBody,
  inspectionGaugeBody,
  inspectionMeasurementBody,
  inspectionSampleBody,
  isPickingListLocked,
  type issueMaterialBody,
  pickingListStatus,
  pickingListStatusBody,
  type pickQuantityBody,
  printBody,
  quantityBody,
  type scrapBody,
  startEventBody,
  type stepRecordBody
} from "./models";

describe("JSON bodies accept what the web validators produce", () => {
  it("startEventBody covers productionEventValidator's start fields", () => {
    type Web = z.output<typeof productionEventValidator>;
    type Api = z.output<typeof startEventBody>;
    expectTypeOf<Api["jobOperationId"]>().toEqualTypeOf<
      Web["jobOperationId"]
    >();
    expectTypeOf<Api["type"]>().toEqualTypeOf<Web["type"]>();
  });

  it("quantityBody matches baseQuantityValidator", () => {
    type Web = z.output<typeof baseQuantityValidator>;
    type Api = z.output<typeof quantityBody>;
    expectTypeOf<Api["quantity"]>().toEqualTypeOf<Web["quantity"]>();
    expectTypeOf<Api["trackingType"]>().toEqualTypeOf<Web["trackingType"]>();
    expectTypeOf<Api["jobOperationId"]>().toEqualTypeOf<
      Web["jobOperationId"]
    >();
  });

  it("scrapBody keeps the reason required, as the web does", () => {
    type Web = z.output<typeof scrapQuantityValidator>;
    type Api = z.output<typeof scrapBody>;
    expectTypeOf<Api["scrapReasonId"]>().toEqualTypeOf<Web["scrapReasonId"]>();
  });

  it("issueMaterialBody matches issueValidator's adjustment types", () => {
    type Web = z.output<typeof issueValidator>;
    type Api = z.output<typeof issueMaterialBody>;
    expectTypeOf<Api["adjustmentType"]>().toEqualTypeOf<
      Web["adjustmentType"]
    >();
    expectTypeOf<Api["itemId"]>().toEqualTypeOf<Web["itemId"]>();
  });

  it("stepRecordBody matches stepRecordValidator", () => {
    type Web = z.output<typeof stepRecordValidator>;
    type Api = z.output<typeof stepRecordBody>;
    expectTypeOf<Api["index"]>().toEqualTypeOf<Web["index"]>();
    expectTypeOf<Api["jobOperationStepId"]>().toEqualTypeOf<
      Web["jobOperationStepId"]
    >();
  });

  it("pickQuantityBody matches pickQuantityValidator's line and quantity", () => {
    type Web = z.output<typeof pickQuantityValidator>;
    type Api = z.output<typeof pickQuantityBody>;
    expectTypeOf<Api["pickingListLineId"]>().toEqualTypeOf<
      Web["pickingListLineId"]
    >();
    expectTypeOf<Api["quantity"]>().toEqualTypeOf<Web["quantity"]>();
  });
});

describe("parsing", () => {
  it("requires a positive quantity", () => {
    const base = { jobOperationId: "op1" };
    expect(quantityBody.safeParse({ ...base, quantity: 10 }).success).toBe(
      true
    );
    expect(quantityBody.safeParse({ ...base, quantity: 0 }).success).toBe(
      false
    );
    expect(quantityBody.safeParse({ ...base, quantity: -1 }).success).toBe(
      false
    );
  });

  it("keeps quantity decimals — quantities carry 5 (numeric-precision)", () => {
    const parsed = quantityBody.parse({
      jobOperationId: "op1",
      quantity: 4.33333
    });
    expect(parsed.quantity).toBe(4.33333);
  });

  it("refuses a work type it does not know", () => {
    expect(
      startEventBody.safeParse({ jobOperationId: "op1", type: "Setup" }).success
    ).toBe(true);
    expect(
      startEventBody.safeParse({ jobOperationId: "op1", type: "Teardown" })
        .success
    ).toBe(false);
  });

  it("refuses a picking status outside the enum", () => {
    for (const status of pickingListStatus) {
      expect(pickingListStatusBody.safeParse({ status }).success).toBe(true);
    }
    expect(
      pickingListStatusBody.safeParse({ status: "Reopened" }).success
    ).toBe(false);
  });

  it("lets a print body carry fields this build does not name", () => {
    const parsed = printBody.parse({
      sourceDocument: "Job Operation",
      sourceDocumentId: "op1",
      somethingNewer: 42
    });
    expect(parsed.sourceDocument).toBe("Job Operation");
  });
});

describe("isPickingListLocked", () => {
  it("locks every terminal status and nothing else", () => {
    expect(isPickingListLocked("Completed")).toBe(true);
    expect(isPickingListLocked("Partial")).toBe(true);
    expect(isPickingListLocked("Cancelled")).toBe(true);
    expect(isPickingListLocked("Draft")).toBe(false);
    expect(isPickingListLocked("In Progress")).toBe(false);
    expect(isPickingListLocked(null)).toBe(false);
  });
});

describe("inspection bodies", () => {
  it("agree with the web validators on the values they both accept", () => {
    type WebSample = z.output<typeof inspectionSampleValidator>;
    type ApiSample = z.output<typeof inspectionSampleBody>;
    expectTypeOf<ApiSample["status"]>().toEqualTypeOf<WebSample["status"]>();
    expectTypeOf<ApiSample["inspectionId"]>().toEqualTypeOf<
      WebSample["inspectionId"]
    >();

    type WebMeasurement = z.output<typeof inspectionMeasurementValidator>;
    type ApiMeasurement = z.output<typeof inspectionMeasurementBody>;
    expectTypeOf<ApiMeasurement["inspectionFeatureId"]>().toEqualTypeOf<
      WebMeasurement["inspectionFeatureId"]
    >();
    // A reading stays a STRING on both sides; the engine parses it against
    // the feature's nominal and tolerances, which may not be numeric at all.
    expectTypeOf<ApiMeasurement["value"]>().toEqualTypeOf<
      WebMeasurement["value"]
    >();
    expectTypeOf<ApiMeasurement["passed"]>().toEqualTypeOf<
      WebMeasurement["passed"]
    >();

    type WebGauge = z.output<typeof inspectionGaugeValidator>;
    type ApiGauge = z.output<typeof inspectionGaugeBody>;
    expectTypeOf<ApiGauge["inspectionFeatureId"]>().toEqualTypeOf<
      WebGauge["inspectionFeatureId"]
    >();

    type WebDisposition = z.output<typeof inspectionDispositionValidator>;
    type ApiDisposition = z.output<typeof inspectionDispositionBody>;
    expectTypeOf<ApiDisposition["decision"]>().toEqualTypeOf<
      WebDisposition["decision"]
    >();
    expectTypeOf<ApiDisposition["operationId"]>().toEqualTypeOf<
      WebDisposition["operationId"]
    >();
    expectTypeOf<ApiDisposition["scrapQuantity"]>().toEqualTypeOf<
      WebDisposition["scrapQuantity"]
    >();

    type WebComplete = z.output<typeof inspectionCompletePassedValidator>;
    type ApiComplete = z.output<typeof inspectionCompletePassedBody>;
    expectTypeOf<ApiComplete["operationId"]>().toEqualTypeOf<
      WebComplete["operationId"]
    >();
  });

  it("takes the serial allocation as arrays and the NCR flag as a boolean", () => {
    // The two places the shapes deliberately diverge: FormData cannot carry a
    // list or a boolean, so the web encodes the allocation as JSON strings and
    // the flag as "true"/"false". JSON needs neither.
    type ApiDisposition = z.output<typeof inspectionDispositionBody>;
    expectTypeOf<ApiDisposition["scrapEntityIds"]>().toEqualTypeOf<
      string[] | undefined
    >();
    expectTypeOf<ApiDisposition["reworkEntityIds"]>().toEqualTypeOf<
      string[] | undefined
    >();
    expectTypeOf<ApiDisposition["createNcr"]>().toEqualTypeOf<
      boolean | undefined
    >();

    const parsed = inspectionDispositionBody.parse({
      inspectionId: "ins_1",
      decision: "Reject",
      operationId: "op_1",
      scrapEntityIds: ["te_1", "te_2"],
      scrapReasonId: "scr_1",
      createNcr: true
    });
    expect(parsed.scrapEntityIds).toEqual(["te_1", "te_2"]);
    expect(parsed.createNcr).toBe(true);
  });

  it("carries a reading's digits through untouched", () => {
    // `.claude/rules/numeric-precision.md`: a measurement keeps up to 5
    // decimals and is never rounded on the way in. A schema that coerced this
    // to a number would be the first place the digits could be lost.
    const parsed = inspectionMeasurementBody.parse({
      inspectionId: "ins_1",
      inspectionFeatureId: "ift_1",
      value: "0.06255"
    });
    expect(parsed.value).toBe("0.06255");

    // An empty string is how a cell is CLEARED — it must survive, not be
    // dropped as "missing".
    expect(
      inspectionMeasurementBody.parse({
        inspectionId: "ins_1",
        inspectionFeatureId: "ift_1",
        value: ""
      }).value
    ).toBe("");
  });

  it("refuses a sample status or a decision it does not know", () => {
    for (const status of ["Pending", "Passed", "Failed"]) {
      expect(
        inspectionSampleBody.safeParse({ inspectionId: "ins_1", status })
          .success
      ).toBe(true);
    }
    expect(
      inspectionSampleBody.safeParse({
        inspectionId: "ins_1",
        status: "Scrapped"
      }).success
    ).toBe(false);

    const base = { inspectionId: "ins_1", operationId: "op_1" };
    for (const decision of ["Accept", "Reject", "Partial"]) {
      expect(
        inspectionDispositionBody.safeParse({ ...base, decision }).success
      ).toBe(true);
    }
    expect(
      inspectionDispositionBody.safeParse({ ...base, decision: "Scrap" })
        .success
    ).toBe(false);
  });

  it("refuses a negative allocation", () => {
    const base = {
      inspectionId: "ins_1",
      operationId: "op_1",
      decision: "Reject" as const
    };
    expect(
      inspectionDispositionBody.safeParse({ ...base, scrapQuantity: 0 }).success
    ).toBe(true);
    expect(
      inspectionDispositionBody.safeParse({ ...base, scrapQuantity: -1 })
        .success
    ).toBe(false);
    expect(
      inspectionDispositionBody.safeParse({ ...base, reworkQuantity: -0.5 })
        .success
    ).toBe(false);
  });

  it("lets an absent gaugeId through — that is how a record is cleared", () => {
    const parsed = inspectionGaugeBody.parse({
      inspectionId: "ins_1",
      inspectionFeatureId: "ift_1"
    });
    expect(parsed.gaugeId).toBeUndefined();
    expect(
      inspectionGaugeBody.parse({
        inspectionId: "ins_1",
        inspectionFeatureId: "ift_1",
        gaugeId: ""
      }).gaugeId
    ).toBe("");
  });
});
