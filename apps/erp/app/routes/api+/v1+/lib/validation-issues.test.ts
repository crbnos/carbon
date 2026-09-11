import { describe, expect, it } from "vitest";
import { formatValidationIssues } from "./validation-issues";

describe("formatValidationIssues", () => {
  it("names each field and its problem", () => {
    expect(
      formatValidationIssues([
        { path: ["jobId"], message: "Required" },
        {
          path: ["requiresBatchTracking"],
          message: "Invalid input: expected string, received boolean"
        }
      ])
    ).toBe(
      "Input validation failed — jobId: Required; requiresBatchTracking: Invalid input: expected string, received boolean"
    );
  });

  it("joins nested paths and unwraps { key } segments", () => {
    expect(
      formatValidationIssues([
        { path: ["contact", { key: "email" }], message: "Invalid email" }
      ])
    ).toBe("Input validation failed — contact.email: Invalid email");
  });

  it("handles a pathless issue and caps the list", () => {
    const issues = Array.from({ length: 10 }, (_, i) => ({
      path: [`field${i}`],
      message: "Required"
    }));
    const text = formatValidationIssues(issues);
    expect(text).toContain("field7: Required");
    expect(text).not.toContain("field8");
    expect(text).toContain("+2 more issues");
    expect(formatValidationIssues([{ message: "bad payload" }])).toBe(
      "Input validation failed — bad payload"
    );
  });
});
