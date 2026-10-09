// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { KANBAN_REPLENISHMENT_NOTE_PREFIX } from "@carbon/database/stock-transfer";
import { expect } from "vitest";
import { serverFns } from "../invoke";
import { databaseTest } from "../local-database-test-fixture";
import { kanbanFixture } from "./kanban-test-fixture";

type Fixture = Awaited<ReturnType<typeof kanbanFixture>>;

function replenish(
  f: Fixture,
  input:
    | { mode: "scan"; kanbanId: string }
    | { mode: "level"; kanbanIds?: string[] }
) {
  return serverFns
    .system({ db: f.db, companyId: f.companyId, userId: "system" })
    .invokeOrThrow("kanban-replenish", input);
}

function transfers(f: Fixture) {
  return f.db
    .selectFrom("stockTransfer")
    .select(["id", "kanbanId", "status", "createdBy", "notes"])
    .where("companyId", "=", f.companyId)
    .orderBy("stockTransferId")
    .execute();
}

function lines(f: Fixture, stockTransferId: string) {
  return f.db
    .selectFrom("stockTransferLine")
    .select(["id", "fromStorageUnitId", "toStorageUnitId", "quantity"])
    .where("companyId", "=", f.companyId)
    .where("stockTransferId", "=", stockTransferId)
    .execute();
}

function first<T>(rows: T[]): T {
  const [row] = rows;
  if (row === undefined) throw new Error("expected at least one row");
  return row;
}

function noteText(notes: unknown): string {
  const doc = (typeof notes === "string" ? JSON.parse(notes) : notes) as {
    content: { content: { text: string }[] }[];
  };
  return first(first(doc.content).content).text;
}

databaseTest("level mode at or above the level writes nothing", async () => {
  const f = await kanbanFixture();
  try {
    await f.adjustToBin(12);
    const { results } = await replenish(f, { mode: "level" });
    expect(results).toEqual([
      { kanbanId: f.kanbanId, outcome: "at-level", projectedQuantity: 12 }
    ]);
    expect(await transfers(f)).toHaveLength(0);
  } finally {
    await f.cleanup();
  }
});

databaseTest(
  "level mode below the level creates one Released kanban transfer",
  async () => {
    const f = await kanbanFixture();
    try {
      await f.adjustToBin(9);
      const { results } = await replenish(f, { mode: "level" });
      expect(results).toHaveLength(1);
      expect(first(results).outcome).toBe("created");

      const all = await transfers(f);
      expect(all).toHaveLength(1);
      const transfer = first(all);
      expect(transfer.kanbanId).toBe(f.kanbanId);
      expect(transfer.status).toBe("Released");
      expect(transfer.createdBy).toBe("system");
      expect(noteText(transfer.notes)).toBe(
        `${KANBAN_REPLENISHMENT_NOTE_PREFIX} — KB-TEST-ITEM, A → B, 5 EA. Signal: level 10 (projected 9).`
      );

      expect(await lines(f, transfer.id)).toEqual([
        expect.objectContaining({
          fromStorageUnitId: f.fromId,
          toStorageUnitId: f.toId,
          quantity: 5
        })
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "an open transfer counts as supply, so a second signal writes nothing",
  async () => {
    const f = await kanbanFixture();
    try {
      await f.adjustToBin(9);
      await replenish(f, { mode: "level" });
      const { results } = await replenish(f, { mode: "level" });
      expect(results).toEqual([
        { kanbanId: f.kanbanId, outcome: "at-level", projectedQuantity: 14 }
      ]);
      expect(await transfers(f)).toHaveLength(1);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "picking the transfer in full does not re-fire, a further draw-down does",
  async () => {
    const f = await kanbanFixture();
    try {
      await f.adjustToBin(9);
      await replenish(f, { mode: "level" });
      const transfer = first(await transfers(f));
      const line = first(await lines(f, transfer.id));

      await f.db
        .updateTable("stockTransferLine")
        .set({ pickedQuantity: 5 })
        .where("id", "=", line.id)
        .where("companyId", "=", f.companyId)
        .execute();
      await f.adjustFromBin(-5);
      await f.adjustToBin(5);

      const afterPick = await replenish(f, { mode: "level" });
      expect(afterPick.results).toEqual([
        { kanbanId: f.kanbanId, outcome: "at-level", projectedQuantity: 14 }
      ]);

      await f.adjustToBin(-6);
      const afterDrawDown = await replenish(f, { mode: "level" });
      expect(first(afterDrawDown.results).outcome).toBe("created");
      expect(await transfers(f)).toHaveLength(2);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest("scan mode creates a transfer even above the level", async () => {
  const f = await kanbanFixture();
  try {
    await f.adjustToBin(12);
    const { results } = await replenish(f, {
      mode: "scan",
      kanbanId: f.kanbanId
    });
    expect(first(results).outcome).toBe("created");

    const transfer = first(await transfers(f));
    expect(transfer.kanbanId).toBe(f.kanbanId);
    expect(noteText(transfer.notes)).toContain("Signal: scan by");
  } finally {
    await f.cleanup();
  }
});

databaseTest(
  "the database refuses a Transfer kanban whose From equals its To",
  async () => {
    const f = await kanbanFixture();
    try {
      await expect(
        f.db
          .updateTable("kanban")
          .set({ fromStorageUnitId: f.toId })
          .where("id", "=", f.kanbanId)
          .where("companyId", "=", f.companyId)
          .execute()
      ).rejects.toThrow(/kanban_transfer_distinct_storage_units_check/);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a kanban id outside the company gets no outcome and no transfer",
  async () => {
    const f = await kanbanFixture();
    try {
      const { results } = await replenish(f, {
        mode: "level",
        kanbanIds: ["kb-not-in-this-company"]
      });
      expect(results).toEqual([]);
      expect(await transfers(f)).toHaveLength(0);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a storage unit at another location is refused (CWE-639)",
  async () => {
    const f = await kanbanFixture();
    try {
      await f.db
        .insertInto("location")
        .values({
          id: `${f.companyId}-elsewhere`,
          name: "Elsewhere",
          addressLine1: "2 Test Way",
          city: "Testville",
          postalCode: "00000",
          timezone: "America/New_York",
          companyId: f.companyId,
          createdBy: "system"
        })
        .execute();
      await f.db
        .updateTable("storageUnit")
        .set({ locationId: `${f.companyId}-elsewhere` })
        .where("id", "=", f.fromId)
        .where("companyId", "=", f.companyId)
        .execute();

      const { results } = await replenish(f, {
        mode: "scan",
        kanbanId: f.kanbanId
      });
      expect(results).toEqual([
        {
          kanbanId: f.kanbanId,
          outcome: "invalid",
          reason: "Storage unit does not belong to the kanban location"
        }
      ]);
      expect(await transfers(f)).toHaveLength(0);
    } finally {
      await f.cleanup();
    }
  }
);
