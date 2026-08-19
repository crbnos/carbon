import { describe, expect, it, vi } from "vitest";

// items.server's only runtime dependency; stubbed so the pure verdict logic
// can be tested without dragging in the app's full module graph.
vi.mock("~/modules/settings", () => ({ getCompanySettings: vi.fn() }));

// items.server pulls the items module graph (via ~/modules/items), which
// transitively loads @carbon/glossary — whose module-load-time Lingui `msg`
// macro isn't transformed under plain vitest and throws. Stub it; the verdict
// logic under test needs none of it.
vi.mock("@carbon/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn()
}));

const { getLockVerdict, LOCKED_REVISION_MESSAGE, getItemOrderabilityIssue } =
  await import("./items.server");

describe("getLockVerdict", () => {
  it("allows edits when the revision is not locked", () => {
    for (const releaseControl of ["off", "warn", "enforce"] as const) {
      expect(getLockVerdict({ isLocked: false, releaseControl })).toEqual({
        ok: true,
        warn: false
      });
    }
  });

  it("allows edits on a locked revision when release control is off", () => {
    expect(getLockVerdict({ isLocked: true, releaseControl: "off" })).toEqual({
      ok: true,
      warn: false
    });
  });

  it("allows edits with a warning on a locked revision when release control is warn", () => {
    expect(getLockVerdict({ isLocked: true, releaseControl: "warn" })).toEqual({
      ok: true,
      warn: true,
      message: LOCKED_REVISION_MESSAGE
    });
  });

  it("blocks edits on a locked revision when release control is enforce", () => {
    expect(
      getLockVerdict({ isLocked: true, releaseControl: "enforce" })
    ).toEqual({
      ok: false,
      warn: false,
      message: LOCKED_REVISION_MESSAGE
    });
  });
});

type Row = Record<string, unknown> | null;

// Stands in for the two reads the guard makes: the `item` row and, when that
// row names a change order, the `changeOrder` row.
function fakeClient(rows: { item?: Row; changeOrder?: Row }) {
  return {
    from(table: string) {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({
          data: rows[table as keyof typeof rows] ?? null,
          error: null
        })
      };
      return builder;
    }
  } as never;
}

const args = { itemId: "item_1", companyId: "company_1" };

const revision = {
  readableIdWithRevision: "P000001.A",
  active: true,
  changeOrderId: "co_1"
};

describe("getItemOrderabilityIssue", () => {
  it("rejects an inactive item, naming it", async () => {
    const client = fakeClient({
      item: {
        readableIdWithRevision: "P000001",
        active: false,
        changeOrderId: null
      }
    });

    expect(await getItemOrderabilityIssue(client, args)).toBe(
      "P000001 is inactive."
    );
  });

  // `active` alone cannot catch this: a draft revision can be switched Active
  // by hand before its change order ships.
  it("rejects an active item whose change order is unreleased", async () => {
    const client = fakeClient({
      item: revision,
      changeOrder: { changeOrderId: "ECO-000001", status: "Draft" }
    });

    expect(await getItemOrderabilityIssue(client, args)).toBe(
      "P000001.A was created by change order ECO-000001, which has not been released yet."
    );
  });

  // Release leaves changeOrderId in place as a provenance link, so the column
  // alone cannot answer "is this still a draft".
  it("passes an item whose change order is released", async () => {
    const client = fakeClient({
      item: revision,
      changeOrder: { changeOrderId: "ECO-000001", status: "Done" }
    });

    expect(await getItemOrderabilityIssue(client, args)).toBeNull();
  });
});
