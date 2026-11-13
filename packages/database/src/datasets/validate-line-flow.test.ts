// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { motor } from "./data/motor/index.ts";
import type {
  Dataset,
  InventoryData,
  ItemsData,
  JobSpec,
  KanbanItemSpec,
  ProductionData,
  TrackedStockSpec
} from "./types.ts";
import { validateDataset } from "./validate.ts";

// A copy of motor with the line-flow fields patched in. Only the touched
// sections are copied: the dataset holds functions structuredClone refuses.
function withLineFlow(patch: {
  items?: Partial<ItemsData>;
  inventory?: Partial<InventoryData>;
  production?: Partial<ProductionData>;
}): Dataset {
  return {
    ...motor,
    items: { ...motor.items, ...patch.items },
    inventory: { ...motor.inventory, ...patch.inventory },
    production: { ...motor.production, ...patch.production }
  };
}

const violationsOn = (dataset: Dataset, field: string) =>
  validateDataset(dataset).filter((v) => v.includes(field));

const withTracked = (item: string, patch: Partial<TrackedStockSpec>) =>
  withLineFlow({
    inventory: {
      onHandTracked: motor.inventory.onHandTracked.map((tracked) =>
        tracked.item === item ? { ...tracked, ...patch } : tracked
      )
    }
  });

const withKanban = (item: string, patch: Partial<KanbanItemSpec>) =>
  withLineFlow({
    inventory: {
      kanbanItems: motor.inventory.kanbanItems.map((kanban) =>
        kanban.item === item ? { ...kanban, ...patch } : kanban
      )
    }
  });

const withJobs = (patches: Record<string, Partial<JobSpec>>) =>
  withLineFlow({
    production: {
      jobs: motor.production.jobs.map((job) =>
        patches[job.key] ? { ...job, ...patches[job.key] } : job
      )
    }
  });

const serialsOf = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${prefix}-${i + 1}`);

describe("line-flow validation", () => {
  it("accepts motor as it ships", () => {
    expect(validateDataset(motor)).toEqual([]);
  });

  it("accepts a work center shelf and refuses an unknown one", () => {
    const workCenter = motor.foundation.workCenters[0]!.name;
    const known = withTracked("MAG-NDFB-38", { shelf: `wc:${workCenter}` });
    expect(
      violationsOn(known, "shelf").filter((v) => v.includes("unknown"))
    ).toEqual([]);

    const violations = violationsOn(
      withTracked("MAG-NDFB-38", { shelf: "wc:No Such Center" }),
      'unknown shelf "wc:No Such Center"'
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("shelf");
  });

  it("refuses a bom operation that is no bop order", () => {
    const method = motor.items.methods.find((m) => m.bom.length > 0)!;
    const [line, ...rest] = method.bom;
    const dataset = withLineFlow({
      items: {
        methods: motor.items.methods.map((m) =>
          m === method
            ? { ...m, bom: [{ ...line!, operation: 99 }, ...rest] }
            : m
        )
      }
    });
    const violations = violationsOn(dataset, "is not a bop order");
    expect(violations).toEqual([
      `items.methods "${method.readableId}" bom "${line!.component}": operation 99 is not a bop order`
    ]);
  });

  it("refuses a replenishmentLevel on a kanban that is not Transfer", () => {
    const violations = violationsOn(
      withKanban("FST-M6-SS", { replenishmentLevel: 2 }),
      "replenishmentLevel"
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("Buy kanban");
  });

  it("refuses a replenishmentLevel that is not a whole number of 0 or more", () => {
    for (const level of [-1, 1.5]) {
      const violations = violationsOn(
        withKanban("MAT-VARNISH", { replenishmentLevel: level }),
        "replenishmentLevel"
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain("not an integer of 0 or more");
    }
  });

  it("refuses a tracked shelf that is not a shelf", () => {
    const violations = violationsOn(
      withTracked("MAG-NDFB-38", { shelf: "No-Such-Shelf" }),
      'unknown shelf "No-Such-Shelf"'
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("shelf");
  });

  it("refuses a Scrapped entity on a tracked shelf", () => {
    const tracked = motor.inventory.onHandTracked.find(
      (t) => t.item === "MAG-NDFB-38"
    )!;
    const [first, second] = tracked.entities;
    const violations = violationsOn(
      withTracked("MAG-NDFB-38", {
        shelf: "Magnet-Vault",
        entities: [
          first!,
          {
            ...second!,
            status: "Scrapped",
            scrap: {
              shelf: "Magnet-Vault",
              reason: "Quality",
              dateOffset: -10,
              comment: "Chipped"
            }
          }
        ]
      }),
      "Scrapped entity"
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("shelf");
  });

  it("refuses tracked lots that do not sum to the opening stock", () => {
    const violations = violationsOn(
      withTracked("MAG-NDFB-45", { shelf: "Magnet-Vault" }),
      "entity quantities"
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("openingStock 480");
  });

  it("accepts tracked lots that sum to the opening stock", () => {
    expect(
      violationsOn(
        withTracked("MAG-NDFB-38", { shelf: "Magnet-Vault" }),
        "MAG-NDFB-38"
      )
    ).toEqual([]);
  });

  it("refuses serials on an item that is not Serial-tracked", () => {
    const violations = violationsOn(
      withJobs({ planned: { serials: serialsOf("STA", 4) } }),
      "serials"
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("not Serial-tracked");
  });

  it("refuses a serials count that differs from the job quantity", () => {
    const violations = violationsOn(
      withJobs({ "in-progress": { serials: serialsOf("MTR", 5) } }),
      "serials"
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("not the job quantity 6");
  });

  it("refuses a serial that repeats across jobs", () => {
    const violations = violationsOn(
      withJobs({
        "in-progress": { serials: serialsOf("MTR", 6) },
        ready: { serials: ["MTR-1", ...serialsOf("M45", 3)] }
      }),
      "serials"
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('"MTR-1" repeats across jobs');
  });

  it("refuses a serial that is an onHandTracked readableId", () => {
    const violations = violationsOn(
      withJobs({
        ready: { serials: ["ENC2048-SN-0031", ...serialsOf("M45", 3)] }
      }),
      "serials"
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("inventory.onHandTracked");
  });

  it("refuses a serial that is a genealogy input readableId", () => {
    const input = motor.production.genealogyInputs[0]!.readableId;
    const violations = violationsOn(
      withJobs({ ready: { serials: [input, ...serialsOf("M45", 3)] } }),
      "serials"
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("production.genealogyInputs");
  });

  it("refuses a serial that is the genealogy assembly serial", () => {
    const serial = motor.production.genealogyAssembly!.serial.readableId;
    const violations = violationsOn(
      withJobs({ ready: { serials: [serial, ...serialsOf("M45", 3)] } }),
      "serials"
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("production.genealogyAssembly");
  });

  it("accepts fractional tracked lots that sum to the opening stock", () => {
    const dataset = withLineFlow({
      inventory: {
        openingStock: motor.inventory.openingStock.map((stock) =>
          stock.item === "MAG-NDFB-38" && stock.shelf === "Magnet-Vault"
            ? { ...stock, qty: 0.3 }
            : stock
        ),
        onHandTracked: motor.inventory.onHandTracked.map((tracked) =>
          tracked.item === "MAG-NDFB-38"
            ? {
                ...tracked,
                shelf: "Magnet-Vault",
                entities: [
                  { readableId: "LOT-MAG38-2606", quantity: 0.1 },
                  { readableId: "LOT-MAG38-2607", quantity: 0.2 }
                ]
              }
            : tracked
        )
      }
    });
    expect(violationsOn(dataset, "entity quantities")).toEqual([]);
  });
});
