import { describe, expect, it, vi } from "vitest";

// resources.models' module graph transitively builds Lingui `msg` descriptors at
// module load. The macro isn't transformed under plain vitest, so raw `msg`
// throws. Stub it to a plain string builder; the validator under test is
// untouched.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray | string, ...values: unknown[]) =>
    Array.isArray(strings)
      ? strings.reduce(
          (acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ""),
          ""
        )
      : String(strings)
}));

const { abilityValidator } = await import("./resources.models");

// An ability is a process's qualification: it is created ONLY by picking a
// process, and it does not carry its own name (the name derives from the linked
// process). So the validator must require `processId` and must not accept a
// free-form `name`.
describe("abilityValidator", () => {
  it("accepts a processId (recertifyEveryDays optional)", () => {
    const parsed = abilityValidator.safeParse({ processId: "proc_1" });
    expect(parsed.success).toBe(true);
  });

  it("requires a processId", () => {
    const parsed = abilityValidator.safeParse({ recertifyEveryDays: 30 });
    expect(parsed.success).toBe(false);
  });

  it("does not carry a free-form name", () => {
    const parsed = abilityValidator.safeParse({
      processId: "proc_1",
      name: "Welding"
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect("name" in parsed.data).toBe(false);
    }
  });
});
