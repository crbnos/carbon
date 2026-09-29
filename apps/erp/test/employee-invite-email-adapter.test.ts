import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("employee invite email adapter", () => {
  it("uses the shared adapter and its configured sender", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../app/routes/x+/users+/employees.bulk-invite.tsx"),
      "utf8"
    );

    expect(source).toContain('from "@carbon/lib/email.server"');
    expect(source).not.toContain("RESEND_DOMAIN");
    expect(source).not.toContain('from "@carbon/lib/resend.server"');
  });
});
