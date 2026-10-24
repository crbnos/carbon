// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("employee invite email adapter", () => {
  it("uses the shared adapter and its configured sender", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../app/modules/users/users.service.ts"),
      "utf8"
    );

    expect(source).toContain('from "@carbon/lib/email.server"');
    expect(source).not.toContain("RESEND_DOMAIN");
    expect(source).not.toContain('from "@carbon/lib/resend.server"');
  });
});
