import { describe, expect, it } from "vitest";
import { storageTypeValidator, storageUnitValidator } from "./inventory.models";

describe("storageTypeValidator", () => {
  it("trims surrounding whitespace from the name", () => {
    const r = storageTypeValidator.safeParse({ name: "  Pallet  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("Pallet");
  });

  it("rejects a name that is only whitespace", () => {
    const r = storageTypeValidator.safeParse({ name: "   " });
    expect(r.success).toBe(false);
  });
});

describe("storageUnitValidator", () => {
  it("trims surrounding whitespace from the name", () => {
    const r = storageUnitValidator.safeParse({
      name: "Rack A1 ",
      locationId: "loc1"
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("Rack A1");
  });

  it("rejects a name that is only whitespace", () => {
    const r = storageUnitValidator.safeParse({
      name: " ",
      locationId: "loc1"
    });
    expect(r.success).toBe(false);
  });
});
