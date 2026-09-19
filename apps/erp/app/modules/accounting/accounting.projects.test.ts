import { describe, expect, it, vi } from "vitest";

vi.mock("@carbon/glossary", () => ({
  glossaryEntries: () => [],
  terms: {}
}));

import * as accountingModels from "./accounting.models";

type ProjectValidator = {
  safeParse: (
    input: unknown
  ) =>
    | { success: true; data: { name: string; description?: string } }
    | { success: false };
};

const projectValidator = Reflect.get(accountingModels, "projectValidator") as
  | ProjectValidator
  | undefined;

describe("projectValidator", () => {
  it("trims the project name and optional description", () => {
    expect(projectValidator).toBeDefined();
    if (!projectValidator) return;

    const result = projectValidator.safeParse({
      name: "  Apollo Expansion  ",
      description: "  Customer expansion program  "
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        name: "Apollo Expansion",
        description: "Customer expansion program"
      });
    }
  });

  it("rejects a name that is only whitespace", () => {
    expect(projectValidator).toBeDefined();
    if (!projectValidator) return;

    expect(projectValidator.safeParse({ name: "   " }).success).toBe(false);
  });

  it("normalizes an empty description to undefined", () => {
    expect(projectValidator).toBeDefined();
    if (!projectValidator) return;

    const result = projectValidator.safeParse({
      name: "Apollo Expansion",
      description: ""
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.description).toBeUndefined();
  });
});
