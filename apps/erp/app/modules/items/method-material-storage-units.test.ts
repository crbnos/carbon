import { describe, expect, it, vi } from "vitest";

// Importing the real items.service graph transitively loads @carbon/glossary,
// whose module-load-time Lingui `msg` macro isn't transformed under plain vitest
// and throws. The code under test needs none of it, so stub glossary; the service
// under test stays the genuine implementation. (Mirrors items.service.test.ts.)
vi.mock("@carbon/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn()
}));

const { upsertMethodMaterial } = await import("./items.service");
const { methodMaterialValidator } = await import("./items.models");

// A valid methodMaterial payload minus storageUnitIds. No itemId + a non-Make
// methodType keeps upsertMethodMaterial down to a single write call, so the mock
// client below only has to answer the insert/update.
const base = {
  id: "mm1",
  makeMethodId: "mk1",
  order: 1,
  itemType: "Part" as const,
  methodType: "Pull from Inventory" as const,
  sourcingType: "Specified" as const,
  quantity: 2,
  unitOfMeasureCode: "EA"
};

/**
 * Minimal chainable Supabase stub that records the row handed to insert()/update()
 * so a test can assert what upsertMethodMaterial persisted for `storageUnitIds`.
 */
function mockClient() {
  const captured: { insert?: any; update?: any } = {};
  const builder: any = {
    insert: (rows: any[]) => {
      captured.insert = rows[0];
      return builder;
    },
    update: (payload: any) => {
      captured.update = payload;
      return builder;
    },
    select: () => builder,
    eq: () => builder,
    single: async () => ({ data: { id: "mm1" }, error: null })
  };
  const client: any = { from: () => builder };
  return { client, captured };
}

describe("methodMaterialValidator.storageUnitIds", () => {
  const parse = (storageUnitIds: unknown) =>
    methodMaterialValidator.safeParse({ ...base, storageUnitIds });

  it("parses the web form's JSON-string map to an object", () => {
    const r = parse('{"loc1":"su1"}');
    expect(r.success && r.data.storageUnitIds).toEqual({ loc1: "su1" });
  });

  it("accepts a JSON-string {} and an already-parsed object map", () => {
    expect(parse("{}").success && parse("{}").data?.storageUnitIds).toEqual({});
    const r = parse({ loc1: "su1" });
    expect(r.success && r.data.storageUnitIds).toEqual({ loc1: "su1" });
  });

  it("accepts null and an omitted field", () => {
    expect(parse(null).success && parse(null).data?.storageUnitIds).toBeNull();
    const omitted = methodMaterialValidator.safeParse({ ...base });
    expect(omitted.success && omitted.data.storageUnitIds).toBeUndefined();
  });

  it("rejects malformed strings and non-object JSON", () => {
    for (const bad of ["not json", "false", "123", '["a"]']) {
      expect(parse(bad).success).toBe(false);
    }
  });
});

describe("upsertMethodMaterial storageUnitIds normalization", () => {
  it("create: an omitted storageUnitIds is stored as {}", async () => {
    const { client, captured } = mockClient();
    await upsertMethodMaterial(client, {
      ...base,
      companyId: "c1",
      createdBy: "u1"
    } as any);
    expect(captured.insert.storageUnitIds).toEqual({});
  });

  it("create: null and a populated map are stored verbatim", async () => {
    const withNull = mockClient();
    await upsertMethodMaterial(withNull.client, {
      ...base,
      storageUnitIds: null,
      companyId: "c1",
      createdBy: "u1"
    } as any);
    expect(withNull.captured.insert.storageUnitIds).toEqual({});

    const withMap = mockClient();
    await upsertMethodMaterial(withMap.client, {
      ...base,
      storageUnitIds: { loc1: "su1" },
      companyId: "c1",
      createdBy: "u1"
    } as any);
    expect(withMap.captured.insert.storageUnitIds).toEqual({ loc1: "su1" });
  });

  it("update: an omitted storageUnitIds is NOT written (preserves stored value)", async () => {
    const { client, captured } = mockClient();
    await upsertMethodMaterial(client, {
      ...base,
      updatedBy: "u1"
    } as any);
    expect(captured.update).toBeDefined();
    expect("storageUnitIds" in captured.update).toBe(false);
  });

  it("update: explicit null or {} clears it, a map replaces it", async () => {
    const cleared = mockClient();
    await upsertMethodMaterial(cleared.client, {
      ...base,
      storageUnitIds: null,
      updatedBy: "u1"
    } as any);
    expect(cleared.captured.update.storageUnitIds).toEqual({});

    const emptied = mockClient();
    await upsertMethodMaterial(emptied.client, {
      ...base,
      storageUnitIds: {},
      updatedBy: "u1"
    } as any);
    expect(emptied.captured.update.storageUnitIds).toEqual({});

    const replaced = mockClient();
    await upsertMethodMaterial(replaced.client, {
      ...base,
      storageUnitIds: { loc1: "su1" },
      updatedBy: "u1"
    } as any);
    expect(replaced.captured.update.storageUnitIds).toEqual({ loc1: "su1" });
  });

  it("never spreads a bare string into a character map", async () => {
    // The original bug: MCP sent "false", the service spread it into
    // {"0":"f","1":"a",…}. A stray string now normalizes to {}.
    const { client, captured } = mockClient();
    await upsertMethodMaterial(client, {
      ...base,
      storageUnitIds: "false",
      updatedBy: "u1"
    } as any);
    expect(captured.update.storageUnitIds).toEqual({});
  });
});
