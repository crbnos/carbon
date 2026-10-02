// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { OperationQueueItem } from "@carbon/mes-core";
import { describe, expect, it } from "vitest";
import { filterOperationCards, toOperationCard } from "./queues";

/**
 * The Assigned / Active / Recent queues, pinned at their two silent failure
 * points: a card that takes the wrong due date off the wire (the server sends
 * two, and web MES's list and board read different ones), and a search that
 * quietly stops covering one of the four fields web MES searches.
 */

const row = (over: Partial<OperationQueueItem> = {}): OperationQueueItem => ({
  id: "jo_1",
  jobReadableId: "JOB-0001",
  itemReadableId: "PART-100",
  itemDescription: "Bracket",
  description: "Deburr",
  operationStatus: "Ready",
  jobDeadlineType: "Hard Deadline",
  jobDueDate: "2026-10-20",
  operationDueDate: "2026-10-18",
  operationQuantity: 10,
  targetQuantity: 12,
  quantityComplete: 3,
  quantityScrapped: 1,
  workCenterId: "wc_1",
  ...over
});

describe("toOperationCard", () => {
  it("takes the JOB's due date and deadline, as web MES's card list does", () => {
    const card = toOperationCard(row());

    // Not `operationDueDate` — that is what the Kanban board reads, and these
    // screens are the list.
    expect(card.dueDate).toBe("2026-10-20");
    expect(card.deadlineType).toBe("Hard Deadline");
  });

  it("carries both quantities, so the card's `targetQuantity ?? quantity` works", () => {
    expect(toOperationCard(row())).toMatchObject({
      quantity: 10,
      targetQuantity: 12
    });

    // No explicit target: the card must still have a number to fall back to.
    const noTarget = toOperationCard(row({ targetQuantity: null }));
    expect(noTarget.targetQuantity).toBeNull();
    expect(noTarget.quantity).toBe(10);
  });

  it("renames the server's fields to the card's", () => {
    const card = toOperationCard(row());

    expect(card.status).toBe("Ready");
    expect(card.quantityCompleted).toBe(3);
    expect(card.columnId).toBe("wc_1");
  });

  it("turns every absent field into null rather than dropping it", () => {
    const card = toOperationCard({ id: "jo_2" });

    expect(card).toEqual({
      id: "jo_2",
      jobReadableId: null,
      itemReadableId: null,
      itemDescription: null,
      description: null,
      status: null,
      dueDate: null,
      deadlineType: null,
      quantity: null,
      targetQuantity: null,
      quantityCompleted: null,
      quantityScrapped: null,
      columnId: null,
      thumbnailPath: null,
      salesOrderReadableId: null
    });
  });
});

describe("filterOperationCards", () => {
  const cards = [
    toOperationCard(row()),
    toOperationCard(
      row({
        id: "jo_2",
        jobReadableId: "JOB-0002",
        itemReadableId: "PART-200",
        itemDescription: "Housing",
        description: "Anodize"
      })
    )
  ];

  it.each([
    ["job id", "job-0002", "jo_2"],
    ["item id", "part-100", "jo_1"],
    ["item description", "housing", "jo_2"],
    ["operation description", "deburr", "jo_1"]
  ])("matches on %s, case-insensitively", (_what, term, expected) => {
    expect(filterOperationCards(cards, term).map((c) => c.id)).toEqual([
      expected
    ]);
  });

  it("matches a substring, not just a prefix", () => {
    expect(filterOperationCards(cards, "rack").map((c) => c.id)).toEqual([
      "jo_1"
    ]);
  });

  it.each([
    "",
    "   "
  ])("treats %o as no filter and returns everything", (term) => {
    expect(filterOperationCards(cards, term)).toHaveLength(2);
  });

  it("returns nothing when nothing matches", () => {
    expect(filterOperationCards(cards, "flange")).toEqual([]);
  });

  it("skips a card whose searchable fields are all absent", () => {
    const sparse = [...cards, toOperationCard({ id: "jo_3" })];
    expect(filterOperationCards(sparse, "a").map((c) => c.id)).not.toContain(
      "jo_3"
    );
  });
});
