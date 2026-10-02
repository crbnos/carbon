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
  issueValidator,
  pickQuantityValidator,
  productionEventValidator,
  scrapQuantityValidator,
  stepRecordValidator
} from "../../../apps/mes/app/services/models";
import {
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
