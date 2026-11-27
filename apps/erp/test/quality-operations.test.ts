// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { parseDate } from "@internationalized/date";
import { describe, expect, it } from "vitest";
import { type Actor, createServiceContext } from "@carbon/api/service-fn.server";
import { pageClaims } from "./page-claims";
import {
  createIssue,
  createIssueWorkflow,
  createRisk,
  insertGauge,
  saveInspectionDocument,
  setIssueStatus,
  updateGauge,
  updateIssueField,
  updateIssueItemField,
  updateIssueWorkflow,
  updateQualityDocumentField,
  updateRisk
} from "../app/modules/quality/quality.server";
import { gaugeCalibrationPatch } from "../app/modules/quality/quality.service";

const quality = pageClaims({
  quality: {
    view: ["company-1"],
    create: ["company-1"],
    update: ["company-1"],
    delete: ["company-1"]
  }
});

/**
 * A Supabase client whose every query answers with the rows the test names
 * for its table. Any write is recorded, with its values; nothing else is
 * checked.
 */
function client(rows: Record<string, unknown>) {
  const writes: string[] = [];
  const written: { table: string; values: unknown }[] = [];
  const from = (table: string) => {
    const result =
      rows[table] instanceof Error
        ? { data: null, error: rows[table] }
        : { data: rows[table] ?? null, error: null };
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "match", "limit", "order"]) {
      chain[method] = () => chain;
    }
    for (const method of ["insert", "update", "delete"]) {
      chain[method] = (values?: unknown) => {
        writes.push(`${method}:${table}`);
        written.push({ table, values });
        return chain;
      };
    }
    chain.single = chain.maybeSingle = () => Promise.resolve(result);
    chain.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve(result).then(resolve);
    return chain;
  };
  return { from, writes, written } as unknown as {
    from: typeof from;
    writes: string[];
    written: { table: string; values: unknown }[];
  };
}

function contextWith(
  rows: Record<string, unknown> = {},
  actor: Actor = {
    type: "user",
    role: "employee",
    userId: "user-1",
    permissions: quality
  }
) {
  const db = client(rows);
  const ctx = createServiceContext({
    actor,
    company: { id: "company-1", groupId: "group-1" },
    caller: db as never,
    system: () => db as never,
    pg: () => ({}) as never,
    kv: () => ({}) as never
  });
  return { ctx, writes: db.writes, written: db.written };
}

describe("opening an issue", () => {
  const issue = {
    name: "Cracked housing",
    priority: "Medium",
    source: "Internal",
    locationId: "loc-1",
    nonConformanceTypeId: "type-1",
    openDate: "2026-10-16"
  } as const;

  it("refuses a record of another company, and creates nothing", async () => {
    // Every reference is found, except the location.
    const { ctx, writes } = contextWith({
      location: [],
      nonConformanceType: [{ id: "type-1" }]
    });

    const result = await createIssue(ctx, issue);

    expect(result.error).toMatchObject({ category: "notFound" });
    expect(writes).toEqual([]);
  });
});

describe("issue status", () => {
  it("cannot close an issue: closing posts its dispositions", async () => {
    const { ctx } = contextWith();
    const result = await setIssueStatus(ctx, {
      id: "nc-1",
      status: "Closed" as never
    });
    expect(result.error?.category).toBe("validation");
  });

  it("refuses to reopen an issue whose dispositions posted inventory", async () => {
    const { ctx, writes } = contextWith({
      nonConformance: { status: "Closed" },
      itemLedger: [{ id: "il-1" }]
    });

    const result = await setIssueStatus(ctx, {
      id: "nc-1",
      status: "Registered"
    });

    expect(result.error?.category).toBe("rule");
    expect(writes).toEqual([]);
  });
});

describe("a closed issue is locked", () => {
  it("refuses a field change when any of the issues is closed", async () => {
    const { ctx, writes } = contextWith({
      nonConformance: [
        { id: "nc-1", status: "In Progress" },
        { id: "nc-2", status: "Closed" }
      ]
    });

    const result = await updateIssueField(ctx, {
      ids: ["nc-1", "nc-2"],
      field: "priority",
      value: "High"
    });

    expect(result.error?.category).toBe("rule");
    expect(writes).toEqual([]);
  });

  it("refuses a disposition change on a closed issue", async () => {
    const { ctx, writes } = contextWith({
      nonConformanceItem: { nonConformance: { status: "Closed" } }
    });

    const result = await updateIssueItemField(ctx, {
      id: "nci-1",
      field: "disposition",
      value: "Scrap"
    });

    expect(result.error?.category).toBe("rule");
    expect(writes).toEqual([]);
  });

  it("refuses a missing disposition row before any write", async () => {
    const { ctx, writes } = contextWith({ nonConformanceItem: null });

    const result = await updateIssueItemField(ctx, {
      id: "nci-missing",
      field: "disposition",
      value: "Scrap"
    });

    expect(result.error?.category).toBe("notFound");
    expect(writes).toEqual([]);
  });

  it("refuses a negative quantity", async () => {
    const { ctx, writes } = contextWith();
    const result = await updateIssueItemField(ctx, {
      id: "nci-1",
      field: "quantity",
      value: -3,
      expectedQuantity: 0
    });
    expect(result.error?.category).toBe("validation");
    expect(writes).toEqual([]);
  });
});

describe("quality document fields", () => {
  it("refuses a status that is not one", async () => {
    const { ctx, writes } = contextWith();
    const result = await updateQualityDocumentField(ctx, {
      ids: ["qd-1"],
      field: "status",
      value: "Published"
    });
    expect(result.error?.category).toBe("validation");
    expect(writes).toEqual([]);
  });

  it("takes a single tag as the whole list", async () => {
    const { ctx, writes } = contextWith();
    const result = await updateQualityDocumentField(ctx, {
      ids: ["qd-1"],
      field: "tags",
      value: "ISO 9001"
    });
    expect(result.error).toBeNull();
    expect(writes).toEqual(["update:qualityDocument"]);
  });
});

describe("saving an inspection plan", () => {
  it("refuses legacy balloons sent without their anchors", async () => {
    const { ctx, writes } = contextWith();
    const result = await saveInspectionDocument(ctx, {
      inspectionDocumentId: "doc-1",
      balloons: {
        create: [
          {
            tempBalloonAnchorId: "anchor-1",
            label: "1",
            xCoordinate: 0.5,
            yCoordinate: 0.5
          }
        ],
        update: [],
        delete: []
      }
    });
    expect(result.error?.category).toBe("validation");
    expect(writes).toEqual([]);
  });
});

// The record and the gauge are saved in one transaction through Kysely; the
// saves, their locks and refusals are tested against the database
// (`test/database/gauge-calibration-record.test.ts`). This is the decision
// what a calibration does to its gauge.
describe("gaugeCalibrationPatch", () => {
  const today = parseDate("2026-11-25");
  const gauge = {
    lastCalibrationDate: "2026-06-01",
    calibrationIntervalInMonths: 6,
    lastCalibrationStatus: "Out-of-Calibration" as const
  };

  it("leaves the gauge alone for a calibration older than its last", () => {
    expect(
      gaugeCalibrationPatch(
        gauge,
        { dateCalibrated: "2026-05-31", inspectionStatus: "Pass" },
        today
      )
    ).toBeNull();
  });

  it("moves the gauge's dates on a Pass, and resets its notified status", () => {
    expect(
      gaugeCalibrationPatch(
        gauge,
        { dateCalibrated: "2026-06-01", inspectionStatus: "Pass" },
        today
      )
    ).toEqual({
      gaugeCalibrationStatus: "In-Calibration",
      lastCalibrationDate: "2026-06-01",
      nextCalibrationDate: "2026-12-01",
      lastCalibrationStatus: "In-Calibration"
    });
  });

  // Six months after 2026-01-15 is 2026-07-15, before today.
  it("puts a Pass whose next date has passed out of calibration", () => {
    expect(
      gaugeCalibrationPatch(
        { ...gauge, lastCalibrationDate: null },
        { dateCalibrated: "2026-01-15", inspectionStatus: "Pass" },
        today
      )
    ).toMatchObject({
      gaugeCalibrationStatus: "Out-of-Calibration",
      nextCalibrationDate: "2026-07-15",
      lastCalibrationStatus: "In-Calibration"
    });
  });

  it("puts a Fail out of calibration and keeps the notified status", () => {
    expect(
      gaugeCalibrationPatch(
        { ...gauge, lastCalibrationStatus: "In-Calibration" },
        { dateCalibrated: "2026-11-01", inspectionStatus: "Fail" },
        today
      )
    ).toEqual({
      gaugeCalibrationStatus: "Out-of-Calibration",
      lastCalibrationDate: "2026-11-01",
      nextCalibrationDate: "2027-05-01",
      lastCalibrationStatus: "In-Calibration"
    });
  });
});

describe("gauges", () => {
  const statusWritten = (written: { table: string; values: unknown }[]) =>
    (
      written.find((write) => write.table === "gauges")?.values as {
        gaugeCalibrationStatus?: string;
      }
    )?.gaugeCalibrationStatus;

  it("a new gauge takes its calibration status from its dates", async () => {
    const { ctx, written } = contextWith({
      gauges: { id: "g-1", gaugeId: "G-1" }
    });
    const result = await insertGauge(ctx, {
      gaugeId: "G-1",
      gaugeTypeId: "type-1",
      gaugeRole: "Standard",
      lastCalibrationDate: "2026-01-01",
      nextCalibrationDate: "2999-01-01"
    });
    expect(result.error).toBeNull();
    expect(statusWritten(written)).toBe("In-Calibration");
  });

  // A failed calibration leaves the gauge Out-of-Calibration while its next
  // date is still ahead; a rename must not put it back In-Calibration.
  it("an update that sends no date keeps the stored status, and ignores a sent one", async () => {
    const { ctx, written } = contextWith({
      gauge: {
        lastCalibrationDate: "2026-01-01",
        nextCalibrationDate: "2999-01-01"
      },
      gauges: { id: "g-1" }
    });
    const result = await updateGauge(ctx, {
      id: "g-1",
      manufacturer: "Mitutoyo",
      gaugeCalibrationStatus: "In-Calibration"
    } as never);
    expect(result.error).toBeNull();
    const update = written.find((write) => write.table === "gauges")?.values;
    expect(update).toMatchObject({ manufacturer: "Mitutoyo" });
    expect(update).not.toHaveProperty("gaugeCalibrationStatus");
  });

  it.each([
    ["a new gauge", (ctx: never) =>
      insertGauge(ctx, {
        gaugeTypeId: "type-1",
        gaugeRole: "Standard",
        nextCalibrationDate: "next June"
      })],
    ["an update", (ctx: never) =>
      updateGauge(ctx, { id: "g-1", lastCalibrationDate: "2026-02-30x" })]
  ])("%s refuses a date that is not one, before any read", async (_name, save) => {
    const { ctx, writes } = contextWith();
    const result = await save(ctx as never);
    expect(result.error?.category).toBe("validation");
    expect(writes).toEqual([]);
  });

  it("an update that sends one date derives the status from it and the stored other", async () => {
    const { ctx, written } = contextWith({
      gauge: {
        lastCalibrationDate: "2026-01-01",
        nextCalibrationDate: "2999-01-01"
      },
      gauges: { id: "g-1" }
    });
    const result = await updateGauge(ctx, {
      id: "g-1",
      nextCalibrationDate: "2000-01-01"
    });
    expect(result.error).toBeNull();
    expect(statusWritten(written)).toBe("Out-of-Calibration");
  });
});

describe("issue workflows", () => {
  const workflow = {
    id: "ncw-1",
    name: "Supplier defect",
    content: "Contain, then correct.",
    priority: "Medium",
    source: "External"
  } as const;

  it("an update answers the workflow's id, as a create does", async () => {
    const { ctx } = contextWith({ nonConformanceWorkflow: [{ id: "ncw-1" }] });
    const result = await updateIssueWorkflow(ctx, workflow);
    expect(result).toEqual({ data: { id: "ncw-1" }, error: null });
  });

  it("an update of a workflow that matches nothing is refused", async () => {
    const { ctx } = contextWith({ nonConformanceWorkflow: [] });
    const result = await updateIssueWorkflow(ctx, workflow);
    expect(result.error).not.toBeNull();
  });

  it.each([
    ["create", (ctx: never) =>
      createIssueWorkflow(ctx, { ...workflow, requiredActionIds: ["ra-9"] })],
    ["update", (ctx: never) =>
      updateIssueWorkflow(ctx, { ...workflow, requiredActionIds: ["ra-9"] })]
  ])(
    "%s refuses a required action that is not the company's, before any write",
    async (_name, save) => {
      // The company's required actions hold none of the ids sent.
      const { ctx, writes } = contextWith({ nonConformanceRequiredAction: [] });
      const result = await save(ctx as never);
      expect(result.error?.category).toBe("notFound");
      expect(writes).toEqual([]);
    }
  );

  it("a create never inserts with an id the caller chose", async () => {
    const { ctx, written } = contextWith({
      nonConformanceWorkflow: { id: "ncw-new" }
    });
    const result = await createIssueWorkflow(ctx, workflow as never);
    expect(result).toEqual({ data: { id: "ncw-new" }, error: null });
    const [inserted] = written.find(
      (write) => write.table === "nonConformanceWorkflow"
    )?.values as Record<string, unknown>[];
    expect(inserted).not.toHaveProperty("id");
  });
});

describe("recording a risk", () => {
  const risk = {
    title: "Single-source bearing",
    source: "General",
    status: "Open",
    type: "Risk",
    severity: 3,
    likelihood: 2
  } as const;
  const apiKey = (actions: Partial<Record<"view" | "create", string[]>>) =>
    ({
      type: "apiKey",
      createdBy: "user-1",
      permissions: {
        "quality.risks": {
          view: [],
          create: [],
          update: [],
          delete: [],
          ...actions
        }
      }
    }) as Actor;

  it("refuses an API key without Create on quality.risks, before any write", async () => {
    const { ctx, writes } = contextWith(
      {},
      apiKey({ view: ["company-1"] })
    );
    const result = await createRisk(ctx, risk);
    expect(result.error?.category).toBe("forbidden");
    expect(writes).toEqual([]);
  });

  it("records it for a key with Create on quality.risks and answers its id", async () => {
    const { ctx } = contextWith(
      { riskRegister: { id: "risk-1" } },
      apiKey({ create: ["company-1"] })
    );
    const result = await createRisk(ctx, risk);
    expect(result).toEqual({ data: { id: "risk-1" }, error: null });
  });

  it("refuses an assignee who is not an employee of the company", async () => {
    const { ctx, writes } = contextWith({ employee: null });
    const result = await createRisk(ctx, { ...risk, assignee: "user-9" });
    expect(result.error?.category).toBe("rule");
    expect(writes).toEqual([]);
  });

  it.each([0, 6])("refuses a severity of %s, off the form's scale", async (severity) => {
    const { ctx, writes } = contextWith();
    const result = await createRisk(ctx, { ...risk, severity });
    expect(result.error?.category).toBe("validation");
    expect(writes).toEqual([]);
  });

  // The register's itemId foreign key is single-column, and sourceId has none.
  it.each([
    ["an item", { source: "Item", itemId: "item-9" }, "item"],
    ["a job", { source: "Job", sourceId: "job-9" }, "job"],
    ["a customer", { source: "Customer", sourceId: "cust-9" }, "customer"],
    ["a supplier", { source: "Supplier", sourceId: "sup-9" }, "supplier"],
    ["a work center", { source: "Work Center", sourceId: "wc-9" }, "workCenter"],
    ["a quote line", { source: "Quote Line", sourceId: "ql-9" }, "quoteLine"]
  ] as const)(
    "refuses %s of another company, before any write",
    async (_name, reference, table) => {
      const { ctx, writes } = contextWith({ [table]: null });
      const result = await createRisk(ctx, { ...risk, ...reference });
      expect(result.error?.category).toBe("notFound");
      expect(writes).toEqual([]);
    }
  );

  it("records a risk on the company's item", async () => {
    const { ctx } = contextWith({
      item: { id: "item-1" },
      riskRegister: { id: "risk-1" }
    });
    const result = await createRisk(ctx, {
      ...risk,
      source: "Item",
      itemId: "item-1",
      sourceId: "item-1"
    });
    expect(result).toEqual({ data: { id: "risk-1" }, error: null });
  });
});

describe("changing a risk", () => {
  const risk = {
    id: "risk-1",
    title: "Single-source bearing",
    source: "General",
    status: "Open",
    type: "Risk",
    severity: 3,
    likelihood: 2
  } as const;

  it("refuses a new assignee who is not an employee of the company", async () => {
    const { ctx, writes } = contextWith({
      riskRegister: { id: "risk-1", assignee: "user-1" },
      employee: null
    });
    const result = await updateRisk(ctx, { ...risk, assignee: "user-9" });
    expect(result.error?.category).toBe("rule");
    expect(writes).toEqual([]);
  });

  it("refuses to save when the risk cannot be read, before any write", async () => {
    const { ctx, writes } = contextWith({
      riskRegister: new Error("connection reset"),
      employee: { id: "user-9" }
    });
    const result = await updateRisk(ctx, { ...risk, assignee: "user-9" });
    expect(result.error).not.toBeNull();
    expect(writes).toEqual([]);
  });

  it("saves a risk whose unchanged assignee is no longer an employee", async () => {
    const { ctx, writes } = contextWith({
      riskRegister: { id: "risk-1", assignee: "user-9" },
      employee: null
    });
    const result = await updateRisk(ctx, { ...risk, assignee: "user-9" });
    expect(result).toEqual({ data: { id: "risk-1" }, error: null });
    expect(writes).toEqual(["update:riskRegister"]);
  });

  // Written back, the assignee read before the save would undo another
  // save's reassignment made since.
  it("leaves an unchanged assignee and notes left out out of the write", async () => {
    const { ctx, written } = contextWith({
      riskRegister: { id: "risk-1", assignee: "user-9" }
    });
    const result = await updateRisk(ctx, { ...risk, assignee: "user-9" });
    expect(result.error).toBeNull();
    const [update] = written;
    expect(update?.values).not.toHaveProperty("assignee");
    expect(update?.values).not.toHaveProperty("notes");
  });

  it("refuses a changed item or source record of another company, before any write", async () => {
    const stored = {
      id: "risk-1",
      assignee: null,
      source: "Item",
      sourceId: "item-1",
      itemId: "item-1"
    };
    const { ctx, writes } = contextWith({ riskRegister: stored, item: null });
    const item = await updateRisk(ctx, {
      ...risk,
      source: "Item",
      itemId: "item-9",
      sourceId: "item-1"
    });
    const source = await updateRisk(ctx, {
      ...risk,
      source: "Item",
      itemId: "item-1",
      sourceId: "item-9"
    });
    expect([item.error?.category, source.error?.category]).toEqual([
      "notFound",
      "notFound"
    ]);
    expect(writes).toEqual([]);
  });

  // The form posts the saved references on every edit.
  it("saves a risk whose unchanged item is not checked again", async () => {
    const { ctx, writes } = contextWith({
      riskRegister: {
        id: "risk-1",
        assignee: null,
        source: "Item",
        sourceId: "item-1",
        itemId: "item-1"
      },
      item: null
    });
    const result = await updateRisk(ctx, {
      ...risk,
      source: "Item",
      itemId: "item-1",
      sourceId: "item-1"
    });
    expect(result).toEqual({ data: { id: "risk-1" }, error: null });
    expect(writes).toEqual(["update:riskRegister"]);
  });

  it("clears an assignee the form sends empty", async () => {
    const { ctx, written } = contextWith({
      riskRegister: { id: "risk-1", assignee: "user-9" }
    });
    const result = await updateRisk(ctx, { ...risk, assignee: undefined });
    expect(result.error).toBeNull();
    expect(written[0]?.values).toHaveProperty("assignee", null);
  });
});
