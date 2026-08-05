import { describe, expect, it } from "vitest";
import { createMemoryLedger } from "./ledger";

const startedAt = new Date().toISOString();

function claim(nodeId: string, sequence: number) {
  return {
    nodeId,
    nodeType: "action",
    itemKey: "",
    sequence,
    input: { inputs: {} }
  };
}

describe("createMemoryLedger", () => {
  it("keeps settled steps in claim order", async () => {
    const ledger = createMemoryLedger();

    const first = await ledger.claimStep(claim("a", 1));
    const second = await ledger.claimStep(claim("b", 2));
    expect(first.claimed && second.claimed).toBe(true);
    if (!first.claimed || !second.claimed) return;

    await ledger.settleStep({
      stepRunId: first.stepRunId,
      status: "Succeeded",
      output: { record: "r1" },
      startedAt
    });
    await ledger.settleStep({
      stepRunId: second.stepRunId,
      status: "Skipped",
      statusReason: "Nothing to do",
      startedAt
    });

    const records = ledger.records();
    expect(records.map((one) => one.nodeId)).toEqual(["a", "b"]);
    expect(records.map((one) => one.status)).toEqual(["Succeeded", "Skipped"]);
    expect(records.map((one) => one.output)).toEqual([{ record: "r1" }, null]);
    expect(records.map((one) => one.statusReason)).toEqual([
      null,
      "Nothing to do"
    ]);
  });

  it("redacts secret-looking keys the same way the durable ledger does", async () => {
    const ledger = createMemoryLedger();
    const claimed = await ledger.claimStep({
      ...claim("a", 1),
      input: { inputs: { authorization: "Bearer abc", url: "https://x.test" } }
    });
    if (!claimed.claimed) throw new Error("expected a claim");

    expect(ledger.records().map((one) => one.input)).toEqual([
      { inputs: { authorization: "[REDACTED]", url: "https://x.test" } }
    ]);
  });

  it("fails a step left running and reports how many it changed", async () => {
    const ledger = createMemoryLedger();
    const done = await ledger.claimStep(claim("a", 1));
    await ledger.claimStep(claim("b", 2));
    if (!done.claimed) throw new Error("expected a claim");

    await ledger.settleStep({
      stepRunId: done.stepRunId,
      status: "Succeeded",
      startedAt
    });

    expect(await ledger.failInterruptedSteps()).toBe(1);
    const records = ledger.records();
    expect(records.map((one) => one.status)).toEqual(["Succeeded", "Failed"]);
    expect(records.map((one) => one.error)).toEqual([
      null,
      "This step was interrupted and did not finish."
    ]);
  });

  it("writes nothing durable and reports no rows for the durable path", async () => {
    const ledger = createMemoryLedger();
    await ledger.finishRun({ status: "Succeeded", startedAt });
    expect(ledger.records()).toEqual([]);
  });
});
