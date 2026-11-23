// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Active, Over } from "@dnd-kit/core";
import { describe, expect, it } from "vitest";
import {
  type BoardDragEvent,
  type DateSubmission,
  type DatesBoard,
  type DatesDragState,
  mergePendingDateMoves,
  type OperationsBoard,
  type OperationsDragEffect,
  type OperationsDragState,
  pendingDateMoves,
  planCommitSubmissions,
  reduceDatesDrag,
  reduceOperationsDrag
} from "./drag-lifecycle";
import { comparePriorityThenId } from "./placement";
import type { Column, DraggableData, Item, JobItem } from "./types";

// dnd-kit's Active/Over also carry rects, which the reducers never read.
function ref(data: DraggableData) {
  const id = data.type === "item" ? data.item.id : data.column.id;
  return { id, data: { current: data }, disabled: false } as unknown as Active &
    Over;
}
const card = (item: Item) => ref({ type: "item", item });
const lane = (column: Column) => ref({ type: "column", column });

const start = (active: Active): BoardDragEvent => ({ type: "start", active });
const over = (active: Active, target: Over | null): BoardDragEvent => ({
  type: "over",
  active,
  over: target
});
const end = (active: Active, target: Over | null): BoardDragEvent => ({
  type: "end",
  active,
  over: target
});
const cancel: BoardDragEvent = { type: "cancel" };

describe("Operations board drag", () => {
  const columns: Column[] = [
    { id: "wc-1", title: "Work Center 1", type: ["Process"] },
    { id: "wc-2", title: "Work Center 2", type: ["Process"] }
  ];
  const op = (id: string, columnId: string, priority: number) =>
    ({ id, columnId, columnType: "Process", priority, title: id }) as Item;
  const a = op("operation-a", "wc-1", 0);
  const b = op("operation-b", "wc-1", 10);
  const c = op("operation-c", "wc-2", 20);
  // A live batch is one card in its work-center column.
  const batch = {
    id: "batch:BAT1",
    columnId: "wc-1",
    columnType: "Process",
    priority: 5,
    title: "Batch BAT0001",
    batchId: "BAT1",
    batchReadableId: "BAT0001",
    batchStatus: "Active",
    members: []
  } as Item;

  function board(
    items: Item[] = [a, b, c],
    boardColumns: Column[] = columns
  ): OperationsBoard {
    const sorted = [...items].sort(comparePriorityThenId);
    return {
      items: sorted,
      itemsById: new Map(sorted.map((item) => [item.id, item])),
      columnsById: new Map(boardColumns.map((column) => [column.id, column])),
      columnOrder: boardColumns.map((column) => column.id)
    };
  }

  function run(events: BoardDragEvent[], ops = board()) {
    let state: OperationsDragState = null;
    const effects: OperationsDragEffect[] = [];
    for (const event of events) {
      const result = reduceOperationsDrag(state, event, ops);
      state = result.state;
      if (result.effect) effects.push(result.effect);
    }
    return effects;
  }

  const moveAToC = {
    type: "commit",
    commit: { columnId: "wc-2", updates: [{ id: "operation-a", priority: 19 }] }
  };

  it("writes once, on the drop, after hovering across other cards and columns", () => {
    expect(
      run([
        start(card(a)),
        over(card(a), card(b)),
        over(card(a), lane(columns[1]!)),
        over(card(a), card(c)),
        end(card(a), card(c))
      ])
    ).toEqual([expect.objectContaining(moveAToC)]);
  });

  it.each([
    ["outside every target", null],
    ["on its own card", card(a)]
  ])("writes nothing for a drop %s", (_where, target) => {
    expect(run([start(card(a)), end(card(a), target)])).toEqual([]);
  });

  it("does not commit the last hover when the drop lands back on the source card", () => {
    expect(
      run([start(card(a)), over(card(a), card(c)), end(card(a), card(a))])
    ).toEqual([]);
  });

  it("ignores a drop after cancel, then commits a fresh drag", () => {
    expect(
      run([
        start(card(a)),
        over(card(a), card(c)),
        cancel,
        end(card(a), card(c)),
        start(card(a)),
        end(card(a), card(c))
      ])
    ).toEqual([expect.objectContaining(moveAToC)]);
  });

  it("writes once when dnd-kit repeats the end callback", () => {
    expect(
      run([start(card(a)), end(card(a), card(c)), end(card(a), card(c))])
    ).toHaveLength(1);
  });

  it("refuses a drop on a work center that does not run the operation's process", () => {
    const assembly = { id: "wc-2", title: "Assembly", type: ["Assembly"] };
    expect(
      run(
        [start(card(a)), end(card(a), lane(assembly))],
        board([a, b, c], [columns[0]!, assembly])
      )
    ).toEqual([]);
  });

  it("reorders columns locally", () => {
    expect(
      run([start(lane(columns[0]!)), end(lane(columns[0]!), lane(columns[1]!))])
    ).toEqual([{ type: "reorderColumns", columnOrder: ["wc-2", "wc-1"] }]);
  });

  it("drops a cancelled column gesture", () => {
    expect(
      run([
        start(lane(columns[0]!)),
        cancel,
        end(lane(columns[0]!), lane(columns[1]!))
      ])
    ).toEqual([]);
  });

  it("writes a single cross-column move through the operation endpoint", () => {
    const ops = board();
    const [effect] = run([start(card(a)), end(card(a), card(c))], ops);
    if (effect?.type !== "commit") throw new Error("expected a commit");
    expect(
      planCommitSubmissions(effect.origin, effect.commit, ops.itemsById)
    ).toEqual([
      {
        action: "operation",
        payload: { id: "operation-a", columnId: "wc-2", priority: 19 },
        fetcherKey: "item:operation-a",
        flushSync: true
      }
    ]);
  });

  it("sends a renumbered column as one request", () => {
    // Unsequenced operations all sit at priority 1, so there is no gap to drop
    // into and the column is renumbered 1..N.
    const x1 = op("x1", "wc-1", 1);
    const x2 = op("x2", "wc-1", 1);
    const x3 = op("x3", "wc-1", 1);
    const ops = board([x1, x2, x3]);
    const [effect] = run([start(card(x1)), end(card(x1), card(x2))], ops);
    if (effect?.type !== "commit") throw new Error("expected a commit");
    expect(
      planCommitSubmissions(effect.origin, effect.commit, ops.itemsById)
    ).toEqual([
      {
        action: "operation",
        payload: {
          columnId: "wc-1",
          updates: JSON.stringify([
            { id: "x1", priority: 2 },
            { id: "x3", priority: 3 }
          ])
        },
        fetcherKey: "reorder:wc-1",
        flushSync: false
      }
    ]);
  });

  it("reassigns a batch's work center when it is dropped on another column", () => {
    const ops = board([a, b, c, batch]);
    const [effect] = run(
      [start(card(batch)), end(card(batch), lane(columns[1]!))],
      ops
    );
    if (effect?.type !== "commit") throw new Error("expected a commit");
    expect(
      planCommitSubmissions(effect.origin, effect.commit, ops.itemsById)
    ).toEqual([
      {
        action: "batching",
        payload: { intent: "update", batchId: "BAT1", workCenterId: "wc-2" },
        fetcherKey: "item:batch:BAT1",
        flushSync: true
      }
    ]);
  });

  it("reprioritizes, not reassigns, a batch dropped within its own column", () => {
    const ops = board([a, b, c, batch]);
    const [effect] = run([start(card(batch)), end(card(batch), card(a))], ops);
    if (effect?.type !== "commit") throw new Error("expected a commit");
    expect(
      planCommitSubmissions(effect.origin, effect.commit, ops.itemsById)
    ).toEqual([
      {
        action: "batching",
        payload: { intent: "reprioritize", batchId: "BAT1", priority: -1 },
        fetcherKey: "item:batch:BAT1",
        flushSync: true
      }
    ]);
  });
});

describe("Dates board drag", () => {
  const ACTION = "/x/priority/dates/update";
  const columns: Column[] = [
    { id: "2026-08-08", title: "Aug 8", type: ["Job"] },
    { id: "2026-08-15", title: "Aug 15", type: ["Job"] },
    { id: "next-week", title: "Next Week", type: ["Job"] }
  ];
  const job = (
    id: string,
    columnId: string,
    priority: number,
    dueDate?: string | null
  ) =>
    ({
      id,
      columnId,
      columnType: "Job",
      priority,
      dueDate,
      title: id
    }) as JobItem;
  // Week columns hold seven dates: job-a sits in Aug 8 but is due Aug 9.
  const jobs = [
    job("job-a", "2026-08-08", 0, "2026-08-09T15:30:00.000Z"),
    job("job-b", "2026-08-08", 10, "2026-08-10T15:30:00.000Z"),
    job("job-c", "2026-08-15", 20, "2026-08-16T15:30:00.000Z")
  ];

  function pendingFetcher(fields: Record<string, string>) {
    const formData = new FormData();
    for (const [key, value] of Object.entries({
      id: "job-a",
      locationId: "location-1",
      priority: "5",
      ...fields
    })) {
      formData.set(key, value);
    }
    return { formAction: ACTION, formData };
  }

  function board(
    items: JobItem[] = jobs,
    fetchers: { formAction?: string; formData?: FormData }[] = []
  ): DatesBoard {
    const itemsById = mergePendingDateMoves(
      items,
      pendingDateMoves(fetchers, { action: ACTION, locationId: "location-1" })
    );
    return {
      items: [...itemsById.values()].sort(comparePriorityThenId),
      itemsById,
      columnsById: new Map(columns.map((column) => [column.id, column])),
      locationId: "location-1"
    };
  }

  // Drag `id` onto `targetId`, hovering `hovers` first, as the board renders them.
  function drop(
    dates: DatesBoard,
    id: string,
    targetId: string | null,
    hovers: string[] = []
  ) {
    const at = (cardId: string) => card(dates.itemsById.get(cardId)!);
    const events = [
      start(at(id)),
      ...hovers.map((hover) => over(at(id), at(hover))),
      end(at(id), targetId === null ? null : at(targetId))
    ];
    return run(events, dates);
  }

  function run(events: BoardDragEvent[], dates: DatesBoard) {
    let state: DatesDragState = null;
    const submissions: DateSubmission[] = [];
    for (const event of events) {
      const result = reduceDatesDrag(state, event, dates);
      state = result.state;
      if (result.submission) submissions.push(result.submission);
    }
    return submissions;
  }

  it("writes once on the drop and keeps the job's exact date within its week", () => {
    expect(
      drop(board(), "job-a", "job-b", ["job-c", "job-b", "job-c"])
    ).toEqual([
      {
        id: "job-a",
        locationId: "location-1",
        columnId: "2026-08-09",
        optimisticColumnId: "2026-08-08",
        priority: 11
      }
    ]);
  });

  it("takes the destination week's date when moved to another week", () => {
    expect(drop(board(), "job-a", "job-c")).toEqual([
      {
        id: "job-a",
        locationId: "location-1",
        columnId: "2026-08-15",
        optimisticColumnId: "2026-08-15",
        priority: 19
      }
    ]);
  });

  it.each([
    ["outside every target", null],
    ["on its own card", "job-a"]
  ])("writes nothing for a drop %s", (_where, target) => {
    expect(drop(board(), "job-a", target)).toEqual([]);
  });

  it("does not commit the last hover when the drop lands back on the source card", () => {
    expect(drop(board(), "job-a", "job-a", ["job-b"])).toEqual([]);
  });

  it("ignores a drop after cancel, then commits a fresh drag", () => {
    const dates = board();
    const a = card(dates.itemsById.get("job-a")!);
    const b = card(dates.itemsById.get("job-b")!);
    expect(
      run([start(a), over(a, b), cancel, end(a, b), start(a), end(a, b)], dates)
    ).toHaveLength(1);
  });

  it("writes once when dnd-kit repeats the end callback", () => {
    const dates = board();
    const a = card(dates.itemsById.get("job-a")!);
    const b = card(dates.itemsById.get("job-b")!);
    expect(run([start(a), end(a, b), end(a, b)], dates)).toHaveLength(1);
  });

  it("reorders a job with a move still in flight using the date that move persists", () => {
    // job-a was moved from Aug 15 to Aug 9 (shown under Aug 8); the loader
    // still has the old row.
    const dates = board(
      [
        job("job-a", "2026-08-15", 0, "2026-08-16T15:30:00.000Z"),
        job("target", "2026-08-08", 20, "2026-08-16T15:30:00.000Z")
      ],
      [
        pendingFetcher({
          columnId: "2026-08-09",
          optimisticColumnId: "2026-08-08"
        })
      ]
    );
    expect(drop(dates, "job-a", "target", ["target"])).toEqual([
      {
        id: "job-a",
        locationId: "location-1",
        columnId: "2026-08-09",
        optimisticColumnId: "2026-08-08",
        priority: 21
      }
    ]);
  });

  it("keeps an in-flight move to a no-date column as that column", () => {
    const dates = board(
      [jobs[0]!, job("target", "next-week", 20, undefined)],
      [
        pendingFetcher({
          columnId: "next-week",
          optimisticColumnId: "next-week"
        })
      ]
    );
    expect(drop(dates, "job-a", "target", ["target"])).toEqual([
      {
        id: "job-a",
        locationId: "location-1",
        columnId: "next-week",
        optimisticColumnId: "next-week",
        priority: 21
      }
    ]);
  });

  it.each([
    ["missing", {}],
    ["not a real date", { columnId: "2026-02-29" }]
  ])(
    "writes nothing while the in-flight date is %s",
    (_kind, persisted: Record<string, string>) => {
      const dates = board(
        [
          job("job-a", "2026-08-15", 0, "2026-08-16T15:30:00.000Z"),
          job("target", "2026-08-08", 20, "2026-08-16T15:30:00.000Z")
        ],
        [pendingFetcher({ optimisticColumnId: "2026-08-08", ...persisted })]
      );
      expect(dates.itemsById.get("job-a")?.dueDate).toBeUndefined();
      expect(drop(dates, "job-a", "target", ["target"])).toEqual([]);
    }
  );

  it.each([
    ["another location", pendingFetcher({ locationId: "location-2" })],
    ["another action", { ...pendingFetcher({}), formAction: "/x/other" }],
    ["no form data", { formAction: ACTION, formData: undefined }]
  ])("ignores an in-flight fetcher for %s", (_kind, fetcher) => {
    expect(
      pendingDateMoves([fetcher], { action: ACTION, locationId: "location-1" })
    ).toEqual([]);
  });

  it("reads an in-flight move as its optimistic column and persisted date", () => {
    expect(
      pendingDateMoves(
        [
          pendingFetcher({
            columnId: "2026-08-09",
            optimisticColumnId: "2026-08-08"
          })
        ],
        { action: ACTION, locationId: "location-1" }
      )
    ).toEqual([
      {
        id: "job-a",
        priority: 5,
        columnId: "2026-08-08",
        dueDate: "2026-08-09"
      }
    ]);
  });
});
