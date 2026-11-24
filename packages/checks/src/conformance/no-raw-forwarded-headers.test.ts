// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { noRawForwardedHeaders } from "./no-raw-forwarded-headers";

const scan = (contents: string, file = "apps/erp/app/routes/x.tsx") =>
  noRawForwardedHeaders.scan(file, contents);

describe("noRawForwardedHeaders", () => {
  it("flags a raw read of any forwarding header", () => {
    expect(
      scan(`const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";
const host = headers.get('X-Forwarded-Host');
const proto = req.headers["x-forwarded-proto"];
const real = request.headers.has(\`x-real-ip\`);`).map((v) => v.line)
    ).toEqual([1, 2, 3, 4]);
  });

  it("ignores mentions that are not reads, and the helpers themselves", () => {
    expect(scan("// the ALB rewrites `X-Forwarded-Host` here")).toEqual([]);
    expect(
      scan('headers.get("x-forwarded-for")', "packages/utils/src/headers.ts")
    ).toEqual([]);
  });

  it("flags the forgeable client IP reads 4df5f8c9bd fixed, and passes its fix", () => {
    // apps/erp/app/routes/_public+/login.tsx before 4df5f8c9bd: the login
    // rate limit was keyed on the first X-Forwarded-For entry, which the
    // caller chooses.
    const login = [
      '  const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";',
      "  const ratelimit = new Ratelimit({"
    ].join("\n");
    // apps/erp/app/routes/x+/acknowledge.tsx before 4df5f8c9bd: the ITAR
    // acknowledgement stored that same forgeable entry.
    const acknowledge = [
      '  const forwardedFor = request.headers.get("x-forwarded-for");',
      "  const ipAddress =",
      '    forwardedFor?.split(",")[0]?.trim() ||',
      '    request.headers.get("x-real-ip") ||',
      "    null;"
    ].join("\n");
    expect(
      scan(login, "apps/erp/app/routes/_public+/login.tsx").map(
        (v) => v.snippet
      )
    ).toEqual([
      'const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";'
    ]);
    expect(
      scan(acknowledge, "apps/erp/app/routes/x+/acknowledge.tsx").map(
        (v) => v.line
      )
    ).toEqual([1, 4]);
    expect(
      scan(
        '  const ip = getClientIp(request) ?? "127.0.0.1";',
        "apps/erp/app/routes/_public+/login.tsx"
      )
    ).toEqual([]);
  });
});
