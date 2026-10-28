// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { msg } from "@lingui/core/macro";
import { describe, expect, it } from "vitest";
import { SETUP_GROUPS } from "../content/setup";
import type { BoardTask, CheckStateRow, StepDef } from "../types";
import {
  type GateReviewItem,
  gateReviewItems,
  gateVerification,
  isItemTicked,
  reviewItemStatus
} from "./review";

const configure: StepDef = {
  key: "gate:configure",
  n: 2,
  title: msg`Configure`,
  gate: msg`System configured`,
  owner: "carbon",
  timing: msg`Weeks 2 to 5`,
  refSlug: "setup",
  nested: [
    {
      key: "prod:configure-bom",
      label: msg`Import your BOM`,
      detect: "hasItems"
    }
  ]
};

const train: StepDef = {
  key: "gate:train",
  n: 4,
  title: msg`Train`,
  gate: msg`Team trained`,
  owner: "you",
  timing: msg`Weeks 5 to 7`,
  refSlug: "training"
};

const tasks: BoardTask[] = [
  {
    key: "setup-resources",
    label: msg`Resources`,
    stepKey: "gate:configure",
    owner: "carbon",
    setupKeys: ["locations", "work-centers"]
  },
  {
    key: "hosting",
    label: msg`Stand up hosting`,
    stepKey: "gate:configure",
    owner: "carbon"
  },
  {
    key: "first-po",
    label: msg`Send your first purchase order`,
    stepKey: "gate:configure",
    owner: "you",
    evidence: "purchaseOrdersFinalized"
  },
  {
    key: "training-materials",
    label: msg`Build role-based training materials`,
    stepKey: "gate:train",
    owner: "carbon"
  }
];

const setupLabel = (key: string) =>
  SETUP_GROUPS.flatMap((group) => group.rows).find((row) => row.key === key)
    ?.object;

describe("gateReviewItems", () => {
  it("expands a setup-derived task into its Setup Map rows", () => {
    const items = gateReviewItems(configure, tasks, []);
    expect(items.slice(0, 2)).toEqual([
      {
        itemKey: "flag:setup.locations",
        kind: "setupRow",
        taskKey: "setup-resources",
        rowKey: "locations",
        label: setupLabel("locations")
      },
      {
        itemKey: "flag:setup.work-centers",
        kind: "setupRow",
        taskKey: "setup-resources",
        rowKey: "work-centers",
        label: setupLabel("work-centers")
      }
    ]);
    expect(setupLabel("locations")).toBeDefined();
  });

  it("lists a manual task under its own task key", () => {
    const items = gateReviewItems(configure, tasks, []);
    expect(items).toContainEqual({
      itemKey: "task:hosting",
      kind: "task",
      taskKey: "hosting",
      label: msg`Stand up hosting`,
      evidence: undefined
    });
  });

  it("carries an operational task's evidence count", () => {
    const items = gateReviewItems(configure, tasks, []);
    expect(items.find((item) => item.itemKey === "task:first-po")).toEqual({
      itemKey: "task:first-po",
      kind: "task",
      taskKey: "first-po",
      label: msg`Send your first purchase order`,
      evidence: "purchaseOrdersFinalized"
    });
  });

  it("adds custom setup rows to the Configure gate only", () => {
    const configureKeys = gateReviewItems(configure, tasks, ["row_7xk2"]).map(
      (item) => item.itemKey
    );
    const trainKeys = gateReviewItems(train, tasks, ["row_7xk2"]).map(
      (item) => item.itemKey
    );
    expect(configureKeys).toContain("flag:setup.row_7xk2");
    expect(trainKeys).not.toContain("flag:setup.row_7xk2");
  });

  it("orders tasks, then custom rows, then product steps", () => {
    expect(
      gateReviewItems(configure, tasks, ["row_7xk2"]).map(
        (item) => item.itemKey
      )
    ).toEqual([
      "flag:setup.locations",
      "flag:setup.work-centers",
      "task:hosting",
      "task:first-po",
      "flag:setup.row_7xk2",
      "prod:configure-bom"
    ]);
  });

  it("leaves out the tasks of other gates", () => {
    expect(
      gateReviewItems(train, tasks, []).map((item) => item.itemKey)
    ).toEqual(["task:training-materials"]);
  });
});

const setupRow: GateReviewItem = {
  itemKey: "flag:setup.locations",
  kind: "setupRow",
  rowKey: "locations"
};
const task: GateReviewItem = {
  itemKey: "task:hosting",
  kind: "task",
  taskKey: "hosting"
};
const productStep: GateReviewItem = {
  itemKey: "prod:configure-bom",
  kind: "productStep"
};

describe("reviewItemStatus", () => {
  it("reads a setup row's flag as done or todo", () => {
    expect(reviewItemStatus(setupRow, "1")).toBe("done");
    expect(reviewItemStatus(setupRow, "0")).toBe("todo");
    expect(reviewItemStatus(setupRow, undefined)).toBe("todo");
  });

  it("reads a task or product step's stored status", () => {
    expect(reviewItemStatus(task, "blocked")).toBe("blocked");
    expect(reviewItemStatus(productStep, "prog")).toBe("prog");
    expect(reviewItemStatus(task, "1")).toBe("todo");
  });

  it("ticks only finished items", () => {
    expect(isItemTicked(setupRow, "1")).toBe(true);
    expect(isItemTicked(task, "done")).toBe(true);
    expect(isItemTicked(task, "prog")).toBe(false);
    expect(isItemTicked(productStep, "done")).toBe(true);
  });
});

const VERIFIED_AT = "2026-10-06T10:00:00.123+00:00";

const row = (
  itemKey: string,
  value: string,
  fields: Partial<CheckStateRow> = {}
): CheckStateRow => ({
  itemKey,
  kind: "scopeFlag",
  value,
  source: "customer",
  updatedBy: "usr_customer",
  updatedAt: "2026-10-05T16:20:00.000+00:00",
  verifiedAt: null,
  verifiedBy: null,
  ...fields
});

const items: GateReviewItem[] = [
  {
    itemKey: "flag:setup.locations",
    kind: "setupRow",
    taskKey: "setup-resources",
    rowKey: "locations"
  },
  {
    itemKey: "flag:setup.work-centers",
    kind: "setupRow",
    taskKey: "setup-resources",
    rowKey: "work-centers"
  },
  { itemKey: "task:hosting", kind: "task", taskKey: "hosting" },
  { itemKey: "prod:configure-bom", kind: "productStep" }
];

const gateRow = row("gate:configure", "done", {
  kind: "gate",
  source: "staff",
  verifiedAt: VERIFIED_AT,
  verifiedBy: "usr_fde"
});

const stamped = { verifiedAt: VERIFIED_AT, verifiedBy: "usr_fde" };

describe("gateVerification", () => {
  it("is not verified while the gate's own tick has no stamp", () => {
    const rowMap = new Map([
      ["gate:configure", row("gate:configure", "done", { kind: "gate" })],
      ["flag:setup.locations", row("flag:setup.locations", "1")]
    ]);
    expect(gateVerification("gate:configure", items, rowMap)).toEqual({
      verified: false,
      changed: 0,
      changedItemKeys: []
    });
  });

  it("reports no changes when every ticked item kept its stamp", () => {
    const rowMap = new Map([
      ["gate:configure", gateRow],
      ["flag:setup.locations", row("flag:setup.locations", "1", stamped)],
      [
        "task:hosting",
        row("task:hosting", "done", { kind: "task", ...stamped })
      ]
    ]);
    expect(gateVerification("gate:configure", items, rowMap)).toEqual({
      verified: true,
      changed: 0,
      changedItemKeys: []
    });
  });

  it("counts an item ticked after the verification", () => {
    const rowMap = new Map([
      ["gate:configure", gateRow],
      ["flag:setup.locations", row("flag:setup.locations", "1", stamped)],
      [
        "flag:setup.work-centers",
        row("flag:setup.work-centers", "1", {
          updatedAt: "2026-10-06T11:45:00.000+00:00"
        })
      ]
    ]);
    expect(gateVerification("gate:configure", items, rowMap)).toEqual({
      verified: true,
      changed: 1,
      changedItemKeys: ["flag:setup.work-centers"]
    });
  });

  it("counts an item unticked after the verification", () => {
    const rowMap = new Map([
      ["gate:configure", gateRow],
      [
        "task:hosting",
        row("task:hosting", "todo", {
          kind: "task",
          updatedAt: "2026-10-06T10:00:00.5Z"
        })
      ]
    ]);
    expect(
      gateVerification("gate:configure", items, rowMap).changedItemKeys
    ).toEqual(["task:hosting"]);
  });

  it("ignores an item unticked before the verification", () => {
    const rowMap = new Map([
      ["gate:configure", gateRow],
      ["flag:setup.locations", row("flag:setup.locations", "0")],
      [
        "task:hosting",
        // 09:30 UTC: earlier than the 10:00 UTC stamp, though its wall-clock
        // text reads later.
        row("task:hosting", "todo", {
          kind: "task",
          updatedAt: "2026-10-06T11:30:00+02:00"
        })
      ]
    ]);
    expect(gateVerification("gate:configure", items, rowMap).changed).toBe(0);
  });

  it("ignores items nobody ticked", () => {
    const rowMap = new Map([["gate:configure", gateRow]]);
    expect(gateVerification("gate:configure", items, rowMap).changed).toBe(0);
  });
});
