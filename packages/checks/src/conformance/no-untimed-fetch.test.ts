// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { isServerFile, noUntimedFetch } from "./no-untimed-fetch";

const scan = (contents: string, file = "packages/ee/src/x/client.ts") =>
  noUntimedFetch.scan(file, contents).map(({ line, snippet }) => ({
    line,
    snippet
  }));

describe("noUntimedFetch", () => {
  // packages/auth/src/services/self-signup.server.ts, lines 69-72 of 1098851cee^
  it("flags the sign-up settings read from before 1098851cee", () => {
    const file = "packages/auth/src/services/self-signup.server.ts";
    expect(
      scan(
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
      scan(
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
      scan(
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
      scan(
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
      scan(
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
      scan(
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
      scan(`const a = await fetch(url);
const b = await fetch(target, {
  method: request.method,
  ...(hasBody && { duplex: "half" })
});`).map((v) => v.line)
    ).toEqual([1, 2]);
  });

  it("passes a signal variable, a spread of a name and a forwarded call", () => {
    expect(
      scan(`await fetch(url, { signal });
await fetch(url, { method: "GET", signal: controller.signal });
await fetch(url, { ...init, headers });
await fetch(input, init);
const customFetch = (...params) => fetch(...params);`)
    ).toEqual([]);
  });

  it("passes a path on this origin", () => {
    expect(
      scan(`await fetch("/api/model/thumbnail", { method: "POST" });
await fetch(\`/api/items/\${id}\`);
await fetch(path.to.api.modelDownload(id));`)
    ).toEqual([]);
  });

  it("ignores a fetch method, a call on another object and comments", () => {
    expect(
      scan(`class Client {
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
      scan(`this.instance = axios.create({
  baseURL: "https://api.linear.app/graphql",
  headers: { "Content-Type": "application/json" }
});
await axios.post(payload.url, raw, { headers });
await axios.get(url);`).map((v) => v.line)
    ).toEqual([1, 5, 6]);
    expect(
      scan(`axios.create({ baseURL, timeout: 60_000 });
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
      scan(route, "apps/erp/app/routes/x+/page.tsx").map((v) => v.line)
    ).toEqual([2]);
    expect(isServerFile("apps/erp/app/components/Foo.tsx")).toBe(false);
    expect(isServerFile("apps/erp/app/modules/sales/ui/Lines.ts")).toBe(false);
    expect(isServerFile("apps/erp/app/modules/sales/sales.utils.ts")).toBe(
      false
    );
    expect(isServerFile("packages/ee/src/jira/lib/client.ts")).toBe(true);
    expect(
      scan(
        'await fetch("https://api.example.com");',
        "apps/erp/app/hooks/useThing.ts"
      )
    ).toEqual([]);
  });
});
