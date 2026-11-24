// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { noInlineUniqueViolation } from "./no-inline-unique-violation";

describe("noInlineUniqueViolation", () => {
  const scan = (file: string, src: string) =>
    noInlineUniqueViolation.scan(file, src);

  it("flags an inline SQLSTATE comparison in a route", () => {
    const v = scan(
      "apps/erp/app/routes/x.tsx",
      `if (result.error?.code === "23505") {\n  return fail();\n}`
    );
    expect(v).toHaveLength(1);
    expect(v[0]!.line).toBe(1);
  });

  it("accepts the shared helper call", () => {
    expect(
      scan(
        "apps/erp/app/routes/x.tsx",
        `if (isUniqueViolation(result.error)) return fail();`
      )
    ).toHaveLength(0);
  });

  it("exempts the helper's own file", () => {
    expect(
      scan("packages/utils/src/errors.ts", `const UNIQUE_VIOLATION = "23505";`)
    ).toHaveLength(0);
  });
});
