import type { ReactElement } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DateKanban } from "./DateKanban";
import Kanban from "./Kanban";
import type { Column, Item, JobItem } from "./types";

const submit = vi.hoisted(() => vi.fn());
const arrayMove = vi.hoisted(() =>
  vi.fn((items: string[], from: number, to: number) => {
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
  })
);
const capturedDndProps = vi.hoisted(() => ({
  current: null as DndProps | null
}));

type DragItem = Item & {
  columnType: string;
};

type DragActive = {
  id: string;
  data: {
    current: { type: "item" | "column"; item?: DragItem; column?: Column };
  };
};

type DragOver = DragActive & {
  disabled: boolean;
};

type DndProps = {
  onDragStart: (event: { active: DragActive }) => void;
  onDragOver: (event: { active: DragActive; over: DragOver | null }) => void;
  onDragEnd: (event: { active: DragActive; over: DragOver | null }) => void;
  onDragCancel: () => void;
};

type TestFetcher = {
  formAction: string;
  formData: FormData | undefined;
  key: string;
  state: "loading" | "submitting";
  data?: unknown;
};

const fetchers = vi.hoisted(() => ({ current: [] as TestFetcher[] }));

vi.mock("@carbon/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn(),
  glossaryEntries: () => []
}));
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() })
}));
vi.mock("@carbon/react", () => ({
  ClientOnly: () => null,
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
  toast: { error: vi.fn() }
}));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: () => "translated" })
}));
vi.mock("@dnd-kit/core", async () => {
  const actual =
    await vi.importActual<typeof import("@dnd-kit/core")>("@dnd-kit/core");
  return {
    ...actual,
    DndContext: (props: DndProps) => {
      capturedDndProps.current = props;
      return null;
    },
    KeyboardSensor: {},
    MouseSensor: {},
    PointerSensor: {},
    TouchSensor: {},
    useSensor: vi.fn((sensor) => sensor),
    useSensors: vi.fn((...sensors) => sensors)
  };
});
vi.mock("@dnd-kit/sortable", async () => {
  const actual =
    await vi.importActual<typeof import("@dnd-kit/sortable")>(
      "@dnd-kit/sortable"
    );
  return {
    ...actual,
    SortableContext: () => null,
    arrayMove,
    sortableKeyboardCoordinates: vi.fn()
  };
});
vi.mock("react-router", () => ({
  useFetchers: () => fetchers.current,
  useSubmit: () => submit
}));
vi.mock("~/utils/path", () => ({
  path: {
    to: {
      scheduleDatesUpdate: "/schedule/dates/update",
      scheduleOperationUpdate: "/schedule/operations/update"
    }
  }
}));
vi.mock("./components/ColumnCard", () => ({
  BoardContainer: () => null,
  ColumnCard: () => null
}));
vi.mock("./components/ItemCard", () => ({
  ItemCard: () => null
}));
vi.mock("./components/JobCard", () => ({
  JobCard: () => null
}));

const settings = {
  showCustomer: false,
  showDescription: false,
  showDueDate: false,
  showDuration: false,
  showEmployee: false,
  showProgress: false,
  showQuantity: false,
  showStatus: false,
  showSalesOrder: false,
  showThumbnail: false
};

const operationColumns: Column[] = [
  { id: "wc-1", title: "Work Center 1", type: ["Process"] },
  { id: "wc-2", title: "Work Center 2", type: ["Process"] }
];

const operationItems = [
  {
    id: "operation-a",
    columnId: "wc-1",
    columnType: "Process",
    priority: 0,
    title: "Operation A"
  },
  {
    id: "operation-b",
    columnId: "wc-1",
    columnType: "Process",
    priority: 10,
    title: "Operation B"
  },
  {
    id: "operation-c",
    columnId: "wc-2",
    columnType: "Process",
    priority: 20,
    title: "Operation C"
  }
] as DragItem[];

const dateColumns: Column[] = [
  { id: "2026-08-08", title: "Aug 8", type: ["Job"] },
  { id: "2026-08-15", title: "Aug 15", type: ["Job"] }
];

const dateItems = [
  {
    id: "job-a",
    columnId: "2026-08-08",
    columnType: "Job",
    priority: 0,
    dueDate: "2026-08-09T15:30:00.000Z",
    title: "Job A"
  },
  {
    id: "job-b",
    columnId: "2026-08-08",
    columnType: "Job",
    priority: 10,
    dueDate: "2026-08-10T15:30:00.000Z",
    title: "Job B"
  },
  {
    id: "job-c",
    columnId: "2026-08-15",
    columnType: "Job",
    priority: 20,
    dueDate: "2026-08-16T15:30:00.000Z",
    title: "Job C"
  }
] as JobItem[];

function itemActive(item: DragItem): DragActive {
  return {
    id: item.id,
    data: { current: { type: "item" as const, item } }
  };
}

function itemOver(item: DragItem): DragOver {
  return { ...itemActive(item), disabled: false };
}

function columnActive(column: Column): DragActive {
  return {
    id: column.id,
    data: { current: { type: "column" as const, column } }
  };
}

function columnOver(column: Column): DragOver {
  return { ...columnActive(column), disabled: false };
}

function captureBoard(
  Board: (props: any) => ReactElement,
  props: Record<string, unknown>
): DndProps {
  capturedDndProps.current = null;
  renderToStaticMarkup(createElement(Board, props));
  if (!capturedDndProps.current) {
    throw new Error("DndContext was not rendered");
  }
  return capturedDndProps.current;
}

function captureOperationsBoard(
  items: DragItem[] = operationItems,
  columns: Column[] = operationColumns
) {
  return captureBoard(Kanban, {
    ...settings,
    columns,
    items,
    progressByItemId: {},
    tags: []
  });
}

function captureDatesBoard(
  items: JobItem[] = dateItems,
  columns: Column[] = dateColumns
) {
  return captureBoard(DateKanban, {
    ...settings,
    columns,
    items,
    locationId: "location-1",
    progressByItemId: {},
    tags: []
  });
}

function pendingDateFetcher({
  id = "job-a",
  locationId = "location-1",
  priority = "5",
  columnId,
  optimisticColumnId = columnId
}: {
  id?: string;
  locationId?: string;
  priority?: string;
  columnId?: string;
  optimisticColumnId?: string;
}): TestFetcher {
  const formData = new FormData();
  formData.set("id", id);
  formData.set("locationId", locationId);
  formData.set("priority", priority);
  if (columnId !== undefined) {
    formData.set("columnId", columnId);
  }
  if (optimisticColumnId !== undefined) {
    formData.set("optimisticColumnId", optimisticColumnId);
  }
  return {
    formAction: "/schedule/dates/update",
    formData,
    key: `job:${id}`,
    state: "loading"
  };
}

function startItemDrag(board: DndProps, item: DragItem) {
  board.onDragStart({ active: itemActive(item) });
}

beforeEach(() => {
  submit.mockClear();
  arrayMove.mockClear();
  fetchers.current = [];
  capturedDndProps.current = null;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: vi.fn()
    }
  });
});

describe("Dates board drag lifecycle", () => {
  it("submits once on the final changed drop, never during circuitous hover, and preserves the exact date", () => {
    const board = captureDatesBoard();
    const active = dateItems[0];

    startItemDrag(board, active);
    board.onDragOver({
      active: itemActive(active),
      over: itemOver(dateItems[2])
    });
    board.onDragOver({
      active: itemActive(active),
      over: columnOver(dateColumns[1])
    });
    board.onDragOver({
      active: itemActive(active),
      over: itemOver(dateItems[1])
    });

    expect(submit).not.toHaveBeenCalled();

    board.onDragEnd({
      active: itemActive(active),
      over: itemOver(dateItems[1])
    });

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(
      {
        id: "job-a",
        locationId: "location-1",
        columnId: "2026-08-09",
        optimisticColumnId: "2026-08-08",
        priority: 11
      },
      expect.objectContaining({ action: "/schedule/dates/update" })
    );
  });

  it("uses the pending exact persisted date for a chained same-bucket reorder", () => {
    const active = {
      ...dateItems[0],
      columnId: "2026-08-15",
      dueDate: "2026-08-16T15:30:00.000Z"
    };
    const target = {
      ...dateItems[2],
      id: "job-exact-target",
      columnId: "2026-08-08"
    };
    fetchers.current = [
      pendingDateFetcher({
        columnId: "2026-08-09",
        optimisticColumnId: "2026-08-08"
      })
    ];
    const board = captureDatesBoard([active, target]);

    startItemDrag(board, active);
    board.onDragOver({ active: itemActive(active), over: itemOver(target) });
    expect(submit).not.toHaveBeenCalled();

    board.onDragEnd({ active: itemActive(active), over: itemOver(target) });

    expect(submit).toHaveBeenCalledWith(
      {
        id: "job-a",
        locationId: "location-1",
        columnId: "2026-08-09",
        optimisticColumnId: "2026-08-08",
        priority: 21
      },
      expect.objectContaining({ action: "/schedule/dates/update" })
    );
    expect(submit).not.toHaveBeenCalledWith(
      expect.objectContaining({ columnId: "2026-08-16" }),
      expect.anything()
    );
  });

  it("ignores pending date data from another location", () => {
    fetchers.current = [
      pendingDateFetcher({
        locationId: "location-2",
        columnId: "2026-08-16",
        optimisticColumnId: "2026-08-15"
      })
    ];
    const board = captureDatesBoard();
    const active = dateItems[0];

    startItemDrag(board, active);
    board.onDragEnd({
      active: itemActive(active),
      over: itemOver(dateItems[2])
    });

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        locationId: "location-1",
        columnId: "2026-08-15"
      }),
      expect.objectContaining({ action: "/schedule/dates/update" })
    );
    expect(submit).not.toHaveBeenCalledWith(
      expect.objectContaining({ columnId: "2026-08-16" }),
      expect.anything()
    );
  });

  it("ignores a Dates fetcher without form data and preserves the next drag origin", () => {
    fetchers.current = [
      {
        formAction: "/schedule/dates/update",
        formData: undefined,
        key: "job:job-a",
        state: "loading"
      }
    ];
    const board = captureDatesBoard();
    const active = dateItems[0];

    startItemDrag(board, active);
    board.onDragEnd({
      active: itemActive(active),
      over: itemOver(dateItems[1])
    });

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(
      {
        id: "job-a",
        locationId: "location-1",
        columnId: "2026-08-09",
        optimisticColumnId: "2026-08-08",
        priority: 11
      },
      expect.objectContaining({ action: "/schedule/dates/update" })
    );
  });

  it.each([
    ["missing", undefined],
    ["invalid", "2026-02-29"]
  ] as const)("does not submit an unknown pending persisted date (%s)", (_kind, columnId) => {
    const active = {
      ...dateItems[0],
      columnId: "2026-08-15",
      dueDate: "2026-08-16T15:30:00.000Z"
    };
    const target = {
      ...dateItems[2],
      id: "job-exact-target",
      columnId: "2026-08-08"
    };
    fetchers.current = [
      pendingDateFetcher({
        columnId,
        optimisticColumnId: "2026-08-08"
      })
    ];
    const board = captureDatesBoard([active, target]);

    startItemDrag(board, active);
    board.onDragOver({ active: itemActive(active), over: itemOver(target) });
    expect(submit).not.toHaveBeenCalled();

    board.onDragEnd({ active: itemActive(active), over: itemOver(target) });

    expect(submit).toHaveBeenCalledTimes(0);
    expect(submit).not.toHaveBeenCalledWith(
      expect.objectContaining({ columnId: "2026-08-16" }),
      expect.anything()
    );
    for (const unsafeColumnId of [
      "2026-08-08",
      "unscheduled",
      "next-week",
      "next-month"
    ]) {
      expect(submit).not.toHaveBeenCalledWith(
        expect.objectContaining({ columnId: unsafeColumnId }),
        expect.anything()
      );
    }
  });

  it("uses null for a pending sentinel during a chained same-bucket reorder", () => {
    const sentinelTarget = {
      ...dateItems[2],
      id: "job-null-target",
      columnId: "next-week",
      dueDate: undefined
    } as JobItem;
    const columns = [
      ...dateColumns,
      { id: "next-week", title: "Next Week", type: ["Job"] }
    ];
    fetchers.current = [
      pendingDateFetcher({
        columnId: "next-week",
        optimisticColumnId: "next-week"
      })
    ];
    const board = captureDatesBoard([dateItems[0], sentinelTarget], columns);
    const active = dateItems[0];

    startItemDrag(board, active);
    board.onDragOver({
      active: itemActive(active),
      over: itemOver(sentinelTarget)
    });
    expect(submit).not.toHaveBeenCalled();

    board.onDragEnd({
      active: itemActive(active),
      over: itemOver(sentinelTarget)
    });

    expect(submit).toHaveBeenCalledWith(
      {
        id: "job-a",
        locationId: "location-1",
        columnId: "next-week",
        optimisticColumnId: "next-week",
        priority: 21
      },
      expect.objectContaining({ action: "/schedule/dates/update" })
    );
    expect(submit).not.toHaveBeenCalledWith(
      expect.objectContaining({ columnId: "2026-08-09" }),
      expect.anything()
    );
  });

  it.each([
    ["outside", null],
    ["self-target", itemOver(dateItems[0])]
  ])("submits zero times for a %s drag end", (_name, over) => {
    const board = captureDatesBoard();
    const active = dateItems[0];

    startItemDrag(board, active);
    board.onDragEnd({ active: itemActive(active), over });

    expect(submit).not.toHaveBeenCalled();
  });

  it("does not commit a cached hover when ending back on the source card", () => {
    const board = captureDatesBoard();
    const active = dateItems[0];

    startItemDrag(board, active);
    board.onDragOver({
      active: itemActive(active),
      over: itemOver(dateItems[1])
    });
    board.onDragEnd({ active: itemActive(active), over: itemOver(active) });

    expect(submit).not.toHaveBeenCalled();
  });

  it("clears cancellation, permits a fresh drag, and submits only once", () => {
    const board = captureDatesBoard();
    const active = dateItems[0];

    startItemDrag(board, active);
    board.onDragOver({
      active: itemActive(active),
      over: itemOver(dateItems[1])
    });
    board.onDragCancel();
    board.onDragEnd({
      active: itemActive(active),
      over: itemOver(dateItems[1])
    });
    expect(submit).not.toHaveBeenCalled();

    startItemDrag(board, active);
    board.onDragEnd({
      active: itemActive(active),
      over: itemOver(dateItems[1])
    });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("does not submit when an end callback repeats after success", () => {
    const board = captureDatesBoard();
    const active = dateItems[0];
    const over = itemOver(dateItems[1]);

    startItemDrag(board, active);
    board.onDragEnd({ active: itemActive(active), over });
    board.onDragEnd({ active: itemActive(active), over });

    expect(submit).toHaveBeenCalledTimes(1);
  });
});

describe("Operations board drag lifecycle", () => {
  it("submits once on the final changed drop and never during circuitous hover", () => {
    const board = captureOperationsBoard();
    const active = operationItems[0];

    startItemDrag(board, active);
    board.onDragOver({
      active: itemActive(active),
      over: itemOver(operationItems[1])
    });
    board.onDragOver({
      active: itemActive(active),
      over: columnOver(operationColumns[1])
    });
    board.onDragOver({
      active: itemActive(active),
      over: itemOver(operationItems[2])
    });

    expect(submit).not.toHaveBeenCalled();

    board.onDragEnd({
      active: itemActive(active),
      over: itemOver(operationItems[2])
    });

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(
      { id: "operation-a", columnId: "wc-2", priority: 19 },
      expect.objectContaining({ action: "/schedule/operations/update" })
    );
  });

  it.each([
    ["outside", null],
    ["self-target", itemOver(operationItems[0])]
  ])("submits zero times for a %s drag end", (_name, over) => {
    const board = captureOperationsBoard();
    const active = operationItems[0];

    startItemDrag(board, active);
    board.onDragEnd({ active: itemActive(active), over });

    expect(submit).not.toHaveBeenCalled();
  });

  it("does not commit a cached hover when ending back on the source card", () => {
    const board = captureOperationsBoard();
    const active = operationItems[0];

    startItemDrag(board, active);
    board.onDragOver({
      active: itemActive(active),
      over: itemOver(operationItems[2])
    });
    board.onDragEnd({ active: itemActive(active), over: itemOver(active) });

    expect(submit).not.toHaveBeenCalled();
  });

  it("clears item cancellation, permits a fresh drag, and submits only once", () => {
    const board = captureOperationsBoard();
    const active = operationItems[0];
    const over = itemOver(operationItems[2]);

    startItemDrag(board, active);
    board.onDragOver({ active: itemActive(active), over });
    board.onDragCancel();
    board.onDragEnd({ active: itemActive(active), over });
    expect(submit).not.toHaveBeenCalled();

    startItemDrag(board, active);
    board.onDragEnd({ active: itemActive(active), over });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("does not submit when an end callback repeats after success", () => {
    const board = captureOperationsBoard();
    const active = operationItems[0];
    const over = itemOver(operationItems[2]);

    startItemDrag(board, active);
    board.onDragEnd({ active: itemActive(active), over });
    board.onDragEnd({ active: itemActive(active), over });

    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("rejects an incompatible process/work-centre drop without submitting", () => {
    const incompatibleColumn = {
      id: "wc-2",
      title: "Assembly Center",
      type: ["Assembly"]
    };
    const board = captureOperationsBoard(operationItems, [
      operationColumns[0],
      incompatibleColumn
    ]);
    const active = operationItems[0];

    startItemDrag(board, active);
    board.onDragEnd({
      active: itemActive(active),
      over: columnOver(incompatibleColumn)
    });

    expect(submit).not.toHaveBeenCalled();
  });

  it("reorders columns locally without submitting an item update", () => {
    const board = captureOperationsBoard();

    board.onDragStart({ active: columnActive(operationColumns[0]) });
    board.onDragEnd({
      active: columnActive(operationColumns[0]),
      over: columnOver(operationColumns[1])
    });

    expect(arrayMove).toHaveBeenCalledWith(["wc-1", "wc-2"], 0, 1);
    expect(submit).not.toHaveBeenCalled();
  });

  it("clears a cancelled column gesture without reordering or submitting", () => {
    const board = captureOperationsBoard();

    board.onDragStart({ active: columnActive(operationColumns[0]) });
    board.onDragCancel();
    board.onDragEnd({
      active: columnActive(operationColumns[0]),
      over: columnOver(operationColumns[1])
    });

    expect(arrayMove).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });
});
