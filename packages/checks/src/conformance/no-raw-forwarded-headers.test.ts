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
});
