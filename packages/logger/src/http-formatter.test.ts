import { describe, expect, it } from "vitest";
import { httpDevFormatter } from "./http-formatter";

function record(properties: Record<string, unknown>) {
  return {
    category: ["carbon", "http"],
    level: "debug",
    message: ["access log"],
    rawMessage: "access log",
    timestamp: Date.now(),
    properties
  } as never;
}

describe("httpDevFormatter", () => {
  it("renders a pino-style time-only / level / pid / module prefix", () => {
    const line = httpDevFormatter(
      record({ method: "GET", pathname: "/dashboard", status: 200 })
    );
    // [HH:MM:SS.mmm] — time only, no date.
    expect(line).toMatch(/\[\d{2}:\d{2}:\d{2}\.\d{3}\]/);
    // Uppercase level, pid, and the `carbon`-stripped module.
    expect(line).toContain("DEBUG");
    expect(line).toContain(`(${process.pid})`);
    expect(line).toContain("[http]");
    // No full date in the line.
    expect(line).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("includes the query string, redacting sensitive params", () => {
    const line = httpDevFormatter(
      record({
        method: "GET",
        pathname: "/callback",
        search: "?ref=home&token=%5BREDACTED%5D",
        status: 200
      })
    );
    expect(line).toContain("/callback?ref=home&token=%5BREDACTED%5D");
  });

  it("renders the message portion as a morgan dev-style access line — bold colored method, dimmed duration", () => {
    const line = httpDevFormatter(
      record({
        method: "GET",
        pathname: "/dashboard",
        status: 200,
        responseTime: 12.34
      })
    );
    expect(line).toContain(
      "\x1b[1m\x1b[32mGET\x1b[0m \x1b[32m200\x1b[0m /dashboard \x1b[2m12.3 ms\x1b[0m"
    );
  });

  it("colors the method: GET green, POST yellow, DELETE red", () => {
    expect(
      httpDevFormatter(record({ method: "GET", pathname: "/x", status: 200 }))
    ).toContain("\x1b[1m\x1b[32mGET\x1b[0m");
    expect(
      httpDevFormatter(record({ method: "POST", pathname: "/x", status: 200 }))
    ).toContain("\x1b[1m\x1b[33mPOST\x1b[0m");
    expect(
      httpDevFormatter(
        record({ method: "DELETE", pathname: "/x", status: 200 })
      )
    ).toContain("\x1b[1m\x1b[31mDELETE\x1b[0m");
  });

  it("colors 3xx cyan, 4xx yellow, 5xx red", () => {
    expect(
      httpDevFormatter(record({ method: "GET", pathname: "/x", status: 301 }))
    ).toContain("\x1b[36m301\x1b[0m");
    expect(
      httpDevFormatter(record({ method: "GET", pathname: "/x", status: 404 }))
    ).toContain("\x1b[33m404\x1b[0m");
    expect(
      httpDevFormatter(record({ method: "POST", pathname: "/x", status: 500 }))
    ).toContain("\x1b[31m500\x1b[0m");
  });

  it("truncates rather than rounds, and drops a padded trailing zero", () => {
    // 12.36 rounds to 12.4 but truncates to 12.3 — must match truncation.
    expect(
      httpDevFormatter(
        record({
          method: "GET",
          pathname: "/x",
          status: 200,
          responseTime: 12.36
        })
      )
    ).toContain("\x1b[2m12.3 ms\x1b[0m");
    // Exact integer ms — no forced ".0".
    expect(
      httpDevFormatter(
        record({ method: "GET", pathname: "/x", status: 200, responseTime: 5 })
      )
    ).toContain("\x1b[2m5 ms\x1b[0m");
  });

  it("omits response time when absent", () => {
    const line = httpDevFormatter(
      record({ method: "GET", pathname: "/x", status: 200 })
    );
    expect(line).toContain("\x1b[1m\x1b[32mGET\x1b[0m \x1b[32m200\x1b[0m /x");
    expect(line).not.toContain("ms");
  });

  it("falls back to the default rendered message for non-access-log records", () => {
    const line = httpDevFormatter(record({ note: "not an access log" }));
    expect(line).toContain("access log");
  });
});
