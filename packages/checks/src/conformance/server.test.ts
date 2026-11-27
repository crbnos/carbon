// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  noIntegrationIdBranching,
  noInterpolatedErrorLog,
  noLocalTimezone,
  noRawForwardedHeaders,
  isServerFile,
  noRawRedirect,
  noUntimedFetch,
  noZeroConcurrency
} from "./server";

const scanRedirect = (contents: string) =>
  noRawRedirect.scan("apps/erp/app/routes/x.tsx", contents);

describe("noRawRedirect", () => {
  it("flags redirect imported from react-router, on one line or several", () => {
    expect(
      scanRedirect(`import { data, redirect } from "react-router";
import {
  type LoaderFunctionArgs,
  redirectDocument
} from "react-router";`).map((v) => v.line)
    ).toEqual([1, 2]);
  });

  it("accepts the @carbon/utils redirect and other react-router imports", () => {
    expect(
      scanRedirect(`import { redirect, redirectExternal } from "@carbon/utils";
import { data, useNavigate } from "react-router";
import type { LoaderFunctionArgs } from "react-router";`)
    ).toEqual([]);
  });
});

const scanForwardedHeaders = (
  contents: string,
  file = "apps/erp/app/routes/x.tsx"
) => noRawForwardedHeaders.scan(file, contents);

describe("noRawForwardedHeaders", () => {
  it("flags a raw read of any forwarding header", () => {
    expect(
      scanForwardedHeaders(`const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";
const host = headers.get('X-Forwarded-Host');
const proto = req.headers["x-forwarded-proto"];
const real = request.headers.has(\`x-real-ip\`);`).map((v) => v.line)
    ).toEqual([1, 2, 3, 4]);
  });

  it("ignores mentions that are not reads, and the helpers themselves", () => {
    expect(
      scanForwardedHeaders("// the ALB rewrites `X-Forwarded-Host` here")
    ).toEqual([]);
    expect(
      scanForwardedHeaders(
        'headers.get("x-forwarded-for")',
        "packages/utils/src/headers.ts"
      )
    ).toEqual([]);
  });
});

const scanErrorLog = (contents: string) =>
  noInterpolatedErrorLog.scan("apps/erp/app/routes/x.tsx", contents);

describe("noInterpolatedErrorLog", () => {
  it("flags a value interpolated into an error message, on one line or several", () => {
    expect(
      scanErrorLog(`logger.error(\`Failed to upload \${file.name}\`);
log.fatal(
  \`Lost \${id}\`,
  { error }
);`).map((v) => v.line)
    ).toEqual([1, 2]);
  });

  it("allows placeholders, plain templates and lower levels", () => {
    expect(
      scanErrorLog(`logger.error("Failed to upload {fileName}", { fileName });
logger.error(\`Failed to upload\`);
logger.warn(\`Slow \${route}\`);`)
    ).toEqual([]);
  });
});

// This exists because `limit: 0` shipped in two handlers and silently parked
// every webhook delivery in QUEUED — invisible until a live end-to-end run,
// since no unit test reaches createFunction's config object.
describe("noZeroConcurrency", () => {
  const scan = (src: string) => noZeroConcurrency.scan("f.ts", src);

  it("flags the real shape the bug shipped in", () => {
    const v = scan(`inngest.createFunction(
  {
    id: "event-handler-webhook",
    concurrency: {
      limit: 0,
      key: "event.data.data.table"
    }
  },
);`);
    expect(v).toHaveLength(1);
    expect(v[0]!.line).toBe(4);
  });

  it("accepts a real limit", () => {
    expect(scan(`concurrency: {\n  limit: 1,\n  key: "x"\n}`)).toHaveLength(0);
    expect(scan(`concurrency: 1,`)).toHaveLength(0);
  });

  it("ignores an unrelated limit: 0 far from any concurrency block", () => {
    expect(scan(`const opts = { limit: 0, offset: 0 };`)).toHaveLength(0);
    expect(
      scan(
        `concurrency: { limit: 5 },\n${"// pad\n".repeat(30)}const q = { limit: 0 };`
      )
    ).toHaveLength(0);
  });

  it("does not match past the closing brace of the concurrency object", () => {
    // A bounded [\s\S] span reached over the `}` and flagged this.
    expect(scan(`concurrency: {}, const query = { limit: 0 };`)).toHaveLength(
      0
    );
    expect(
      scan(`concurrency: { limit: 2 }, const query = { limit: 0 };`)
    ).toHaveLength(0);
    expect(
      scan(`concurrency: {\n  key: "x"\n},\nconst q = { limit: 0 };`)
    ).toHaveLength(0);
  });

  it("catches every occurrence in a file with more than one handler", () => {
    expect(
      scan(`concurrency: {\n  limit: 0\n}\n\nconcurrency: {\n  limit: 0\n}`)
    ).toHaveLength(2);
  });
});

describe("noLocalTimezone", () => {
  it("flags getLocalTimeZone() in server code", () => {
    const ts = "const d = today(getLocalTimeZone()).toString();";
    const v = noLocalTimezone.scan("apps/erp/app/modules/x/x.service.ts", ts);
    expect(v).toHaveLength(1);
    expect(v[0]?.snippet).toBe("getLocalTimeZone(");
  });

  it("flags UTC day-slicing via split", () => {
    const ts = 'const today = new Date().toISOString().split("T")[0];';
    const v = noLocalTimezone.scan("f.ts", ts);
    expect(v).toHaveLength(1);
  });

  it("flags UTC day-slicing via slice", () => {
    const ts = "const today = new Date().toISOString().slice(0, 10);";
    const v = noLocalTimezone.scan("f.ts", ts);
    expect(v).toHaveLength(1);
  });

  it("flags UTC day-slicing of a supplied instant", () => {
    const cases = [
      'const day = new Date(eventAt).toISOString().split("T")[0];',
      "const day = new Date(entry.clockIn).toISOString().slice(0, 10);"
    ];
    for (const ts of cases) {
      expect(noLocalTimezone.scan("f.ts", ts)).toHaveLength(1);
    }
  });

  it("flags local date-parts of now", () => {
    const cases = [
      "const today = dayNames[new Date().getDay()];",
      "const year = new Date().getFullYear();",
      "const dom = new Date().getDate();"
    ];
    for (const ts of cases) {
      expect(noLocalTimezone.scan("f.ts", ts)).toHaveLength(1);
    }
  });

  it("flags local-midnight boundaries via setHours(0,0,0,0)", () => {
    const ts = "monday.setHours(0, 0, 0, 0);";
    expect(noLocalTimezone.scan("f.ts", ts)).toHaveLength(1);
  });

  it("replays 92c041c48e: the roster and the payroll week used the server's calendar", () => {
    // apps/erp/app/modules/people/people.service.ts before 92c041c48e.
    const before = `  const today = dayNames[new Date().getDay()];

  return data.filter((ej) => {
    const shift = ej.shift as Record<string, unknown> | null;
    return shift && shift[today] === true;
  });
}

export async function getWeeklyHoursForEmployees(
  client: SupabaseClient<Database>,
  companyId: string,
  employeeIds: string[]
): Promise<Record<string, number>> {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7));
  monday.setHours(0, 0, 0, 0);`;
    expect(
      noLocalTimezone
        .scan("apps/erp/app/modules/people/people.service.ts", before)
        .map((v) => [v.line, v.snippet])
    ).toEqual([
      [1, "new Date().getDay("],
      [15, "now.getDay("],
      [17, "now.getDate("],
      [18, ".setHours(0, 0, 0, 0)"]
    ]);
    // The fix: the company calendar.
    const after = `  const tz = await getCompanyTimeZone(client, companyId);
  const dayName = dayNames[getDayOfWeek(today(tz), "en-US")];
  const monday = startOfWeek(today(tz), "en-GB").toDate(tz);`;
    expect(noLocalTimezone.scan("f.ts", after)).toHaveLength(0);
  });

  it("flags a date part of now read through a local", () => {
    const ts = `const now = new Date();
const dow = now.getDay();
const at = now.toISOString();`;
    expect(
      noLocalTimezone.scan("f.ts", ts).map((v) => [v.line, v.snippet])
    ).toEqual([[2, "now.getDay("]]);
  });

  it("leaves a local set from another instant alone", () => {
    const ts = `const when = new Date(row.createdAt);
const y = when.getFullYear();`;
    expect(noLocalTimezone.scan("f.ts", ts)).toHaveLength(0);
  });

  it("allows full-instant timestamps", () => {
    const ts = "const at = new Date().toISOString();";
    expect(noLocalTimezone.scan("f.ts", ts)).toHaveLength(0);
  });

  it("allows UTC getters and local-roundtrip getters", () => {
    const cases = [
      "const dow = d.getUTCDay() || 7;",
      "const y = new Date(Date.UTC(2026, 0, 1)).getUTCFullYear();",
      // pg DATE parsed to local midnight → local getters roundtrip the parts
      "const y = value.getFullYear();",
      // non-midnight setHours (shift wall-times, client prefill) stays legal
      "clockIn.setHours(startH, startM, 0, 0);"
    ];
    for (const ts of cases) {
      expect(noLocalTimezone.scan("f.ts", ts)).toHaveLength(0);
    }
  });

  it("allows the datetime API", () => {
    const ts =
      "const d = datetime.today(await getCompanyTimeZone(client, companyId)).toString();";
    expect(noLocalTimezone.scan("f.ts", ts)).toHaveLength(0);
  });
});

const scanIntegrationIds = (file: string, contents: string) =>
  noIntegrationIdBranching.scan(file, contents);

describe("no-integration-id-branching", () => {
  it("flags an equality branch on an integration id", () => {
    const found = scanIntegrationIds(
      "packages/jobs/src/inngest/functions/integrations/sweep.ts",
      'if (integrationId === "ramp") { return; }'
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.snippet).toContain("ramp");
  });

  it("flags an inequality branch too", () => {
    expect(
      scanIntegrationIds("apps/erp/app/routes/x+/thing.tsx", 'x !== "rillet"')
    ).toHaveLength(1);
  });

  it("flags a Set of ids", () => {
    expect(
      scanIntegrationIds(
        "packages/ee/src/accounting/core/posting.ts",
        'new Set(["xero", "quickbooks"])'
      )
    ).toHaveLength(1);
  });

  it("allows a provider naming ITSELF inside its own directory", () => {
    // packages/ee/src/ramp/** is Ramp's own code; saying "ramp" there is not a
    // branch on identity, it IS the identity.
    expect(
      scanIntegrationIds(
        "packages/ee/src/ramp/lib/spend.ts",
        'if (id === "ramp") {}'
      )
    ).toEqual([]);
  });

  it("allows the registry and the legitimately id-keyed maps", () => {
    for (const file of [
      "packages/ee/src/index.ts",
      "packages/ee/src/hooks.server.ts",
      "packages/ee/src/integrations/secrets.ts",
      "apps/erp/app/modules/settings/integration-errors.ts"
    ]) {
      expect(
        scanIntegrationIds(file, 'x === "ramp"; ["xero", "rillet"]')
      ).toEqual([]);
    }
  });

  it("allows the sync core, which is the replacement", () => {
    expect(
      scanIntegrationIds("packages/ee/src/sync/topology.ts", 'id === "ramp"')
    ).toEqual([]);
  });

  it("ignores an unrelated string that merely contains an id", () => {
    expect(
      scanIntegrationIds(
        "apps/erp/app/thing.ts",
        'const label = "Ramp connection";'
      )
    ).toEqual([]);
  });

  it("reports the line number", () => {
    const found = scanIntegrationIds(
      "apps/erp/app/thing.ts",
      '\n\nif (a === "xero") {}'
    );
    expect(found[0]?.line).toBe(3);
  });
});

const scanUntimedFetch = (
  contents: string,
  file = "packages/ee/src/x/client.ts"
) =>
  noUntimedFetch.scan(file, contents).map(({ line, snippet }) => ({
    line,
    snippet
  }));

describe("noUntimedFetch", () => {
  // packages/auth/src/services/self-signup.server.ts, lines 69-72 of 1098851cee^
  it("flags the sign-up settings read from before 1098851cee", () => {
    const file = "packages/auth/src/services/self-signup.server.ts";
    expect(
      scanUntimedFetch(
        `  try {
    const res = await fetch(\`\${SUPABASE_URL}/auth/v1/settings\`, {
      headers: { apikey: SUPABASE_ANON_KEY }
    });`,
        file
      )
    ).toEqual([
      {
        line: 2,
        snippet: `const res = await fetch(\`\${SUPABASE_URL}/auth/v1/settings\`, {`
      }
    ]);
    // the fix, lines 75-78 of 1098851cee
    expect(
      scanUntimedFetch(
        `    const res = await fetch(\`\${SUPABASE_URL}/auth/v1/settings\`, {
      headers: { apikey: SUPABASE_ANON_KEY },
      signal: AbortSignal.timeout(3_000)
    });`,
        file
      )
    ).toEqual([]);
  });

  // packages/stripe/src/gtm-events.server.ts, lines 19-27 of 1f5183a1f2^
  it("flags the GTM forward from before 1f5183a1f2", () => {
    const file = "packages/stripe/src/gtm-events.server.ts";
    expect(
      scanUntimedFetch(
        `  try {
    const res = await fetch(\`\${GTM_URL}/api/events\`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gtm-events-key": GTM_EVENTS_API_SECRET_KEY
      },
      body: JSON.stringify({ type, metadata })
    });`,
        file
      )
    ).toHaveLength(1);
    // the fix, lines 23-32 of 1f5183a1f2
    expect(
      scanUntimedFetch(
        `  try {
    const res = await fetch(\`\${GTM_URL}/api/events\`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gtm-events-key": GTM_EVENTS_API_SECRET_KEY
      },
      body: JSON.stringify({ type, metadata }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });`,
        file
      )
    ).toEqual([]);
  });

  // packages/ee/src/onshape/lib/oauth.ts, lines 141-153 of 7138724800^
  it("flags the Onshape token exchange from before 7138724800", () => {
    const file = "packages/ee/src/onshape/lib/oauth.ts";
    expect(
      scanUntimedFetch(
        `async function requestToken(
  config: OnshapeOAuthConfig,
  body: Record<string, string>
): Promise<OnshapeTokenResponse> {
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ...body,
      client_id: config.clientId,
      client_secret: config.clientSecret
    })
  });`,
        file
      )
    ).toEqual([
      { line: 5, snippet: "const response = await fetch(config.tokenUrl, {" }
    ]);
    // the fix, lines 162-175 of 7138724800
    expect(
      scanUntimedFetch(
        `async function requestToken(
  config: OnshapeOAuthConfig,
  body: Record<string, string>
): Promise<OnshapeTokenResponse> {
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ...body,
      client_id: config.clientId,
      client_secret: config.clientSecret
    }),
    signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS)
  });`,
        file
      )
    ).toEqual([]);
  });

  it("flags a fetch with no options, and a spread of an inline literal", () => {
    expect(
      scanUntimedFetch(`const a = await fetch(url);
const b = await fetch(target, {
  method: request.method,
  ...(hasBody && { duplex: "half" })
});`).map((v) => v.line)
    ).toEqual([1, 2]);
  });

  it("passes a signal variable, a spread of a name and a forwarded call", () => {
    expect(
      scanUntimedFetch(`await fetch(url, { signal });
await fetch(url, { method: "GET", signal: controller.signal });
await fetch(url, { ...init, headers });
await fetch(input, init);
const customFetch = (...params) => fetch(...params);`)
    ).toEqual([]);
  });

  it("passes a path on this origin", () => {
    expect(
      scanUntimedFetch(`await fetch("/api/model/thumbnail", { method: "POST" });
await fetch(\`/api/items/\${id}\`);
await fetch(path.to.api.modelDownload(id));`)
    ).toEqual([]);
  });

  it("ignores a fetch method, a call on another object and comments", () => {
    expect(
      scanUntimedFetch(`class Client {
  private fetch(method: string, path: string): Promise<Response> {
    return this.send(method, path);
  }
}
const r = await client.fetch(url);
refetch(url);
// await fetch(url) would stall`)
    ).toEqual([]);
  });

  it("flags an axios client or call with no timeout", () => {
    expect(
      scanUntimedFetch(`this.instance = axios.create({
  baseURL: "https://api.linear.app/graphql",
  headers: { "Content-Type": "application/json" }
});
await axios.post(payload.url, raw, { headers });
await axios.get(url);`).map((v) => v.line)
    ).toEqual([1, 5, 6]);
    expect(
      scanUntimedFetch(`axios.create({ baseURL, timeout: 60_000 });
await axios.post(url, raw, { headers, ...webhookTransport });
await axios.get(url, { signal });`)
    ).toEqual([]);
  });

  it("reads only the server half of a route and skips browser files", () => {
    const route = `export async function loader() {
  const res = await fetch("https://api.example.com/x");
}

export default function Page() {
  useEffect(() => {
    fetch("https://api.example.com/y");
  }, []);
}`;
    expect(
      scanUntimedFetch(route, "apps/erp/app/routes/x+/page.tsx").map(
        (v) => v.line
      )
    ).toEqual([2]);
    expect(isServerFile("apps/erp/app/components/Foo.tsx")).toBe(false);
    expect(isServerFile("apps/erp/app/modules/sales/ui/Lines.ts")).toBe(false);
    expect(isServerFile("apps/erp/app/modules/sales/sales.utils.ts")).toBe(
      false
    );
    expect(isServerFile("packages/ee/src/jira/lib/client.ts")).toBe(true);
    expect(
      scanUntimedFetch(
        'await fetch("https://api.example.com");',
        "apps/erp/app/hooks/useThing.ts"
      )
    ).toEqual([]);
  });
});
