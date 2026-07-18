import { describe, expect, it } from "vitest";
import { processValidator } from "./resources.models";

describe("processValidator batchable", () => {
  const base = { name: "Laser Cutting", processType: "Outside" as const };

  it("parses batchable=true when the checkbox is on", () => {
    const r = processValidator.safeParse({ ...base, batchable: "on" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.batchable).toBe(true);
  });

  it("defaults batchable to false when the checkbox is omitted", () => {
    const r = processValidator.safeParse({ ...base });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.batchable).toBe(false);
  });
});
