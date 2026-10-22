// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

// Only so the server modules load in a test process.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray) => ({ id: strings.join("") })
}));
vi.mock("@carbon/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@carbon/env")>()),
  ASSEMBLER_SERVICE_URL: ""
}));
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() })
}));
vi.mock("@carbon/jobs", () => ({ trigger: vi.fn(), batchTrigger: vi.fn() }));
vi.mock("@carbon/planning", () => ({ runLocationSchedule: vi.fn() }));

const { createJobOperation, updateJobOperation } = await import(
  "../app/modules/production/production.server"
);
const { createQuoteOperation, updateQuoteOperation } = await import(
  "../app/modules/sales/sales.server"
);
const { fillOperationStandards } = await import(
  "../app/modules/shared/shared.service"
);

// Only the fields the published schema marks required. The API refused this
// with "Setup unit is required" and eight more, for fields it lists as
// optional: the bill of process form's checks came along with its validator.
const operation = {
  id: "op1",
  order: 1,
  operationOrder: "After Previous",
  operationType: "Process",
  processId: "proc1",
  description: "Weld"
};
const jobOperation = { ...operation, jobId: "job1", jobMakeMethodId: "jmm1" };
const quoteOperation = {
  ...operation,
  quoteId: "q1",
  quoteLineId: "ql1",
  quoteMakeMethodId: "qmm1"
};

describe("operation API input", () => {
  it.each([
    ["createJobOperation", createJobOperation, jobOperation],
    ["updateJobOperation", updateJobOperation, jobOperation],
    ["createQuoteOperation", createQuoteOperation, quoteOperation],
    ["updateQuoteOperation", updateQuoteOperation, quoteOperation]
  ])("%s takes an operation without times, units or rates", (_, fn, input) => {
    expect(fn.input.safeParse(input).success).toBe(true);
  });

  it.each([
    ["createJobOperation", createJobOperation, jobOperation],
    ["createQuoteOperation", createQuoteOperation, quoteOperation]
  ])("%s still needs an inspection plan", (_, fn, input) => {
    const parsed = fn.input.safeParse({ ...input, operationType: "Inspection" });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(["inspectionDocumentId"]);
  });
});

describe("fillOperationStandards", () => {
  const centers = [
    {
      laborRate: 40,
      machineRate: 100,
      overheadRate: 10,
      defaultStandardFactor: "Minutes/Piece" as const
    },
    {
      laborRate: 60,
      machineRate: 200,
      overheadRate: 20,
      defaultStandardFactor: "Hours/Piece" as const
    }
  ];

  it("averages the process's work centers and takes the process's unit", () => {
    const filled = fillOperationStandards(
      { processId: "proc1" },
      {
        processStandardFactor: "Pieces/Hour",
        workCenters: centers,
        supplierProcess: null
      }
    );
    expect(filled).toMatchObject({
      setupUnit: "Total Minutes",
      setupTime: 0,
      laborUnit: "Pieces/Hour",
      machineUnit: "Pieces/Hour",
      laborTime: 0,
      machineTime: 0,
      laborRate: 50,
      machineRate: 150,
      overheadRate: 15
    });
  });

  it("takes the chosen work center's rates and unit", () => {
    const filled = fillOperationStandards(
      { processId: "proc1", workCenterId: "wc1" },
      {
        processStandardFactor: "Pieces/Hour",
        workCenters: [centers[0]!],
        supplierProcess: null
      }
    );
    expect(filled).toMatchObject({
      laborUnit: "Minutes/Piece",
      laborRate: 40,
      machineRate: 100,
      overheadRate: 10
    });
  });

  it("keeps what the caller sent, 0 included", () => {
    const filled = fillOperationStandards(
      { processId: "proc1", laborRate: 0, laborUnit: "Total Hours" },
      {
        processStandardFactor: null,
        workCenters: centers,
        supplierProcess: null
      }
    );
    expect(filled.laborRate).toBe(0);
    expect(filled.laborUnit).toBe("Total Hours");
    expect(filled.machineUnit).toBe("Hours/Piece");
  });

  it("takes an outside operation's costs from its supplier process", () => {
    const filled = fillOperationStandards(
      { processId: "proc1", operationSupplierProcessId: "sp1" },
      {
        processStandardFactor: null,
        workCenters: [],
        supplierProcess: { minimumCost: 75, leadTime: 5 }
      }
    );
    expect(filled).toMatchObject({
      operationMinimumCost: 75,
      operationLeadTime: 5,
      operationUnitCost: 0,
      laborRate: 0
    });
  });
});
