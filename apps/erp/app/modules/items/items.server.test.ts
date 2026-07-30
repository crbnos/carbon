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

const { getLockVerdict, LOCKED_REVISION_MESSAGE } = await import(
  "./items.server"
);

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
