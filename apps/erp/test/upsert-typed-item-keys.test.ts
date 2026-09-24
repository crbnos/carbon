import { describe, expect, it, vi } from "vitest";

// The items.service graph transitively loads @carbon/glossary, whose
// module-load-time Lingui `msg` macro isn't transformed under plain vitest.
// Stub it; the upserts under test stay the genuine implementation.
vi.mock("@carbon/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn()
}));

const { upsertConsumable, upsertPart, upsertService, upsertTool } =
  await import("~/modules/items/items.service");

// Pins the key resolution in the typed-item update branches. `item` is keyed
// by uuid; part/tool/consumable/service are keyed by the item's
// readableId + companyId. Filtering both tables by one id saved the item half
// and silently matched zero typed rows (or the reverse when a readable id was
// passed), with no error either way. Every read tool hands out the uuid, so
// over MCP the typed fields never saved. Materials are pinned with their
// property rules in material-properties.test.ts.

type Call = {
  table: string;
  op: "select" | "update" | "insert" | "upsert" | "delete";
  payload?: Record<string, unknown>;
  filters: Array<[string, string, unknown]>;
  single?: "single" | "maybeSingle";
};
type Response = { data: unknown; error: unknown };

/** A supabase stub that records every query and answers from `respond`. */
function makeClient(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, op: "select", filters: [] };
    let started = false;
    const builder: Record<string, unknown> = {};
    builder.select = () => {
      // A select after a write is the "return the row" modifier.
      if (!started) {
        started = true;
        call.op = "select";
      }
      return builder;
    };
    for (const op of ["update", "insert", "upsert", "delete"] as const) {
      builder[op] = (payload?: Record<string, unknown>) => {
        started = true;
        call.op = op;
        call.payload = payload;
        return builder;
      };
    }
    builder.eq = (column: string, value: unknown) => {
      call.filters.push(["eq", column, value]);
      return builder;
    };
    builder.in = (column: string, value: unknown) => {
      call.filters.push(["in", column, value]);
      return builder;
    };
    builder.single = () => {
      call.single = "single";
      return builder;
    };
    builder.maybeSingle = () => {
      call.single = "maybeSingle";
      return builder;
    };
    builder.then = (
      resolve: (value: Response) => unknown,
      reject?: (reason: unknown) => unknown
    ) => {
      calls.push(call);
      return Promise.resolve(respond(call)).then(resolve, reject);
    };
    return builder;
  };
  return { client: { from } as never, calls };
}

const COMPANY = "company-1";
const ITEM = { id: "item-uuid-1", readableId: "MAT-AL-PLATE" };

/** Answers the item lookups and the two updates from fixed responses. */
function respondWith(opts: {
  byId?: typeof ITEM | null;
  byReadableId?: (typeof ITEM)[];
  itemUpdate?: Response;
  typedUpdate?: Response;
}) {
  return (call: Call): Response => {
    if (call.table === "item" && call.op === "select") {
      const byUuid = call.filters.some(([, column]) => column === "id");
      return byUuid
        ? { data: opts.byId ?? null, error: null }
        : { data: opts.byReadableId ?? [], error: null };
    }
    if (call.op === "update") {
      return call.table === "item"
        ? (opts.itemUpdate ?? { data: { id: ITEM.id }, error: null })
        : (opts.typedUpdate ?? { data: { id: ITEM.readableId }, error: null });
    }
    return { data: null, error: null };
  };
}

const base = {
  name: "Aluminum plate",
  replenishmentSystem: "Buy" as const,
  defaultMethodType: "Pull from Inventory" as const,
  itemTrackingType: "Inventory" as const,
  unitOfMeasureCode: "EA",
  shelfLifeCalculateFromBom: false,
  companyId: COMPANY,
  updatedBy: "user-1"
};

const updates = (calls: Call[]) => calls.filter((c) => c.op === "update");
const updateOf = (calls: Call[], table: string) =>
  updates(calls).find((c) => c.table === table);

describe("typed item updates resolve uuid vs readable id", () => {
  it.each([
    ["part", upsertPart],
    ["tool", upsertTool],
    ["consumable", upsertConsumable],
    ["service", upsertService]
  ] as const)(
    "%s: the typed row is keyed by readableId + companyId",
    async (table, upsert) => {
      const { client, calls } = makeClient(respondWith({ byId: ITEM }));
      // The service validator narrows tracking to Non-Inventory; the payload
      // has to satisfy all four signatures at once.
      const result = await upsert(client, {
        ...base,
        id: ITEM.id,
        itemTrackingType: "Non-Inventory" as const,
        revision: "0",
        customFields: { colour: "red" }
      });
      expect(result.error).toBeNull();

      const typed = updateOf(calls, table);
      expect(typed?.filters).toEqual(
        expect.arrayContaining([
          ["eq", "id", ITEM.readableId],
          ["eq", "companyId", COMPANY]
        ])
      );
      expect(typed?.payload).toMatchObject({ customFields: { colour: "red" } });
      expect(typed?.single).toBe("single");

      const item = updateOf(calls, "item");
      expect(item?.filters).toEqual(
        expect.arrayContaining([
          ["eq", "id", ITEM.id],
          ["eq", "companyId", COMPANY]
        ])
      );
      expect(item?.payload).not.toHaveProperty("id");
    }
  );
});
