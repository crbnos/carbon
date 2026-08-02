import { describe, expect, it } from "vitest";
import type { FilterNode } from "../definition/schema";
import type { Clause } from "../definition/types";
import { filterExecutor, filterSummary } from "./filter";
import { createRuntimeContext, type FakeRows } from "./fixtures";
import { entityValue, listValue } from "./values";

const jobs = ["j1", "j2", "j3", "j4", "j5"];

const rows: FakeRows = {
  "job:j1": { dueDate: "2026-07-01T00:00:00.000Z" },
  "job:j2": { dueDate: "2026-09-01T00:00:00.000Z" },
  "job:j3": { dueDate: "2026-07-15T00:00:00.000Z" },
  "job:j4": { dueDate: "2026-10-01T00:00:00.000Z" },
  "job:j5": { dueDate: "2026-12-01T00:00:00.000Z" }
};

const dueBefore: Clause[] = [
  {
    left: { kind: "item", path: ["dueDate"] },
    operator: "lt",
    right: {
      kind: "literal",
      type: { kind: "primitive", of: "date" },
      value: "2026-08-01T00:00:00.000Z"
    }
  }
];

const node = (clauses: Clause[], source = true): FilterNode => ({
  id: "f1",
  name: "f1",
  type: "filter",
  position: { x: 0, y: 0 },
  data: {
    source: source
      ? { kind: "ref", nodeId: "find", output: "result", path: [] }
      : undefined,
    combinator: "and",
    clauses
  }
});

function contextWith(ids: string[], extraRows: FakeRows = {}) {
  return createRuntimeContext({
    rows: { ...rows, ...extraRows },
    outputs: {
      find: {
        result: listValue(
          { kind: "entity", of: "job" },
          ids.map((id) => entityValue("job", id))
        ).value
      }
    }
  });
}

describe("filterExecutor", () => {
  it("keeps only the items that pass, in the order they arrived", async () => {
    const result = await filterExecutor.execute(
      node(dueBefore),
      contextWith(jobs)
    );
    expect(result).toMatchObject({
      status: "Succeeded",
      handle: "out",
      summary: "Kept 2 of 5."
    });
    expect(result.status === "Succeeded" && result.outputs.result).toEqual(
      listValue({ kind: "entity", of: "job" }, [
        entityValue("job", "j1"),
        entityValue("job", "j3")
      ]).value
    );
  });

  it("drops an item it cannot read and keeps going", async () => {
    const result = await filterExecutor.execute(
      node(dueBefore),
      contextWith([...jobs, "missing"])
    );
    expect(result).toMatchObject({
      status: "Succeeded",
      summary: "Kept 2 of 6; 1 could not be checked."
    });
  });

  it("skips when the source is not a list", async () => {
    const ctx = createRuntimeContext({
      outputs: { find: { result: entityValue("job", "j1") } }
    });
    expect(await filterExecutor.execute(node([]), ctx)).toEqual({
      status: "Skipped",
      reason: "This step expected a list."
    });
  });

  it("skips when no list was chosen", async () => {
    expect(
      await filterExecutor.execute(node([], false), createRuntimeContext())
    ).toEqual({ status: "Skipped", reason: "No list was chosen to filter." });
  });
});

describe("filterSummary", () => {
  it("mentions unreadable items only when there are some", () => {
    expect(filterSummary(2, 5, 0)).toBe("Kept 2 of 5.");
    expect(filterSummary(2, 5, 1)).toBe("Kept 2 of 5; 1 could not be checked.");
  });
});
