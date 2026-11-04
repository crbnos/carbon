// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/// <reference types="node" />
import { createServer, type Server } from "node:http";
import { OpenFeature } from "@openfeature/server-sdk";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi
} from "vitest";
import {
  CarbonFlagsProvider,
  evaluateBrowserFlags,
  type FlagsStore,
  flags,
  parseHeaders,
  type StoredFlags
} from "./flags.server";

type Rule = Record<string, unknown>;

const flagDoc = (
  targeting: Rule | null,
  metadata: Record<string, unknown> = {}
) =>
  JSON.stringify({
    $schema: "https://flagd.dev/schema/v0/flags.json",
    flags: {
      "multi-company-management": {
        state: "ENABLED",
        variants: { on: true, off: false },
        defaultVariant: "off",
        ...(targeting ? { targeting } : {}),
        metadata
      }
    }
  });

const companyRule = (ids: string[]) => ({
  if: [{ in: [{ var: "companyId" }, ids] }, "on", null]
});

/** A local flags source. `doc` and `mode` can change between requests. */
let server: Server;
let url = "";
let doc = flagDoc(companyRule(["cmp_123"]));
let etag = '"v1"';
let mode: "ok" | "hang" | "big" | "down" = "ok";
let requests: {
  ifNoneMatch?: string;
  authorization?: string;
  commit?: string;
}[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    requests.push({
      ifNoneMatch: req.headers["if-none-match"] as string | undefined,
      authorization: req.headers.authorization,
      commit: req.headers["x-carbon-commit"] as string | undefined
    });
    if (mode === "hang") return;
    if (mode === "down") return res.writeHead(503).end();
    if (mode === "big")
      return res.writeHead(200).end("x".repeat((1 << 20) + 10));
    if (req.headers["if-none-match"] === etag) return res.writeHead(304).end();
    res.writeHead(200, { ETag: etag }).end(doc);
  }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/flags`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

afterEach(async () => {
  doc = flagDoc(companyRule(["cmp_123"]));
  etag = '"v1"';
  mode = "ok";
  requests = [];
  vi.restoreAllMocks();
  await OpenFeature.clearProviders();
});

/** A shared store in memory, with the same lease semantics as Redis. */
function memoryStore(): FlagsStore & { data: Map<string, StoredFlags> } {
  const data = new Map<string, StoredFlags>();
  const leases = new Set<string>();
  return {
    data,
    readMeta: async (scope) => {
      const value = data.get(scope);
      return value ? { etag: value.etag, fetchedAt: value.fetchedAt } : null;
    },
    readBody: async (scope) => data.get(scope)?.body ?? null,
    write: async (scope, value) => {
      data.set(scope, { ...(data.get(scope) as StoredFlags), ...value });
    },
    tryLease: async (scope) => {
      if (leases.has(scope)) return { status: "held" };
      leases.add(scope);
      return {
        status: "acquired",
        release: async () => {
          leases.delete(scope);
        }
      };
    }
  };
}

const unavailableStore: FlagsStore = {
  readMeta: async () => null,
  readBody: async () => null,
  write: async () => undefined,
  tryLease: async () => ({ status: "unavailable" })
};

let domain = 0;
async function start(provider: CarbonFlagsProvider) {
  const name = `test-${domain++}`;
  await OpenFeature.setProviderAndWait(name, provider);
  const client = OpenFeature.getClient(name);
  return (companyId: string, userId?: string) =>
    client.getBooleanValue("multi-company-management", false, {
      targetingKey: userId ?? companyId,
      companyId
    });
}

describe("parseHeaders", () => {
  it("keeps '+', decodes '%2C' and '=', and skips a malformed pair", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(
      parseHeaders(
        "Authorization=Bearer%20ab+c%2Cd=,X-Bad=%zz, X-Carbon-Instance = inst_1,no-equals"
      )
    ).toEqual({
      authorization: "Bearer ab+c,d=",
      "x-carbon-instance": "inst_1"
    });
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("CarbonFlagsProvider", () => {
  it("answers the default when no endpoint is set", async () => {
    const read = await start(new CarbonFlagsProvider({}));
    expect(await read("cmp_123")).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it("targets companies, and sends the configured headers", async () => {
    const read = await start(
      new CarbonFlagsProvider({
        endpoint: url,
        headers: "Authorization=Bearer%20tok+1"
      })
    );
    expect(await read("cmp_123")).toBe(true);
    expect(await read("cmp_999")).toBe(false);
    expect(requests[0]?.authorization).toBe("Bearer tok+1");
  });

  it("treats header names case-insensitively, and a configured commit wins", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(parseHeaders("Authorization=a,authorization=b")).toEqual({
      authorization: "b"
    });
    await start(
      new CarbonFlagsProvider({
        endpoint: url,
        commit: "aaaaaaaaaaaaaaaa",
        headers: "X-Carbon-Commit=bbbbbbbbbbbb"
      })
    );
    expect(requests[0]?.commit).toBe("bbbbbbbbbbbb");
  });

  it("sends the first 12 characters of the build's commit as X-Carbon-Commit", async () => {
    await start(
      new CarbonFlagsProvider({
        endpoint: url,
        commit: "abc123def4567890abc123def4567890abc12345"
      })
    );
    expect(requests[0]?.commit).toBe("abc123def456");
  });

  it("targets users inside a company", async () => {
    doc = flagDoc({
      if: [
        {
          and: [
            { in: [{ var: "companyId" }, ["cmp_A"]] },
            { in: [{ var: "targetingKey" }, ["usr_X"]] }
          ]
        },
        "on",
        null
      ]
    });
    const read = await start(new CarbonFlagsProvider({ endpoint: url }));
    expect(await read("cmp_A", "usr_X")).toBe(true);
    expect(await read("cmp_B", "usr_X")).toBe(false);
    expect(await read("cmp_A", "usr_Y")).toBe(false);
  });

  it("adds tenancy and edition to the context", async () => {
    doc = flagDoc({
      if: [
        {
          and: [
            { "==": [{ var: "tenancy" }, "single"] },
            { in: [{ var: "edition" }, ["enterprise"]] }
          ]
        },
        "on",
        null
      ]
    });
    const on = await start(
      new CarbonFlagsProvider({
        endpoint: url,
        tenancy: "single",
        edition: "enterprise"
      })
    );
    const off = await start(
      new CarbonFlagsProvider({
        endpoint: url,
        tenancy: "multi",
        edition: "enterprise"
      })
    );
    const cloud = await start(
      new CarbonFlagsProvider({
        endpoint: url,
        tenancy: "single",
        edition: "cloud"
      })
    );
    expect(await on("cmp_1")).toBe(true);
    expect(await off("cmp_1")).toBe(false);
    expect(await cloud("cmp_1")).toBe(false);
  });

  it("sends the ETag and keeps the flags on a 304", async () => {
    const provider = new CarbonFlagsProvider({ endpoint: url });
    const read = await start(provider);
    await provider.refresh();
    expect(requests.at(-1)?.ifNoneMatch).toBe('"v1"');
    expect(provider.lastError).toBeUndefined();
    expect(await read("cmp_123")).toBe(true);
  });

  it("refuses a body over 1 MB and keeps the loaded flags", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const provider = new CarbonFlagsProvider({ endpoint: url });
    const read = await start(provider);
    mode = "big";
    await provider.refresh();
    expect(provider.lastError).toMatch(/larger than 1 MB/);
    expect(await read("cmp_123")).toBe(true);
  });

  it("refuses an invalid document and keeps the loaded flags", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const provider = new CarbonFlagsProvider({ endpoint: url });
    const read = await start(provider);
    doc = '{"flags":{"x":{"state":"MAYBE"}}}';
    etag = '"v2"';
    await provider.refresh();
    expect(provider.lastError).toBeDefined();
    expect(await read("cmp_123")).toBe(true);
  });

  it("waits at most 2 s at boot when the source hangs and the store is empty", async () => {
    mode = "hang";
    const started = Date.now();
    const read = await start(
      new CarbonFlagsProvider({ endpoint: url, store: memoryStore() })
    );
    expect(Date.now() - started).toBeLessThan(2_600);
    expect(await read("cmp_123")).toBe(false);
  });

  it("does not wait for the source when the store has a copy", async () => {
    const store = memoryStore();
    await start(new CarbonFlagsProvider({ endpoint: url, store }));
    mode = "hang";
    const started = Date.now();
    const read = await start(new CarbonFlagsProvider({ endpoint: url, store }));
    expect(Date.now() - started).toBeLessThan(200);
    expect(await read("cmp_123")).toBe(true);
  });

  it("lets 5 processes share one store with 1 source request", async () => {
    const store = memoryStore();
    const providers = Array.from(
      { length: 5 },
      () => new CarbonFlagsProvider({ endpoint: url, store })
    );
    const reads = await Promise.all(providers.map(start));
    expect(requests).toHaveLength(1);
    for (const read of reads) expect(await read("cmp_123")).toBe(true);

    // Within 60 s, syncs read the store and never call the source.
    await Promise.all(providers.map((provider) => provider.refresh()));
    expect(requests).toHaveLength(1);
  });

  it("carries a new document from one process to another through the store", async () => {
    const store = memoryStore();
    const a = new CarbonFlagsProvider({ endpoint: url, store });
    const b = new CarbonFlagsProvider({ endpoint: url, store });
    await start(a);
    const readB = await start(b);
    expect(await readB("cmp_456")).toBe(false);

    doc = flagDoc(companyRule(["cmp_456"]));
    etag = '"v2"';
    for (const value of store.data.values()) value.fetchedAt = 0; // make it stale
    await a.refresh();
    await b.refresh();
    expect(await readB("cmp_456")).toBe(true);
    expect(requests).toHaveLength(2);
  });

  it("keeps the lease after a failed fetch, so the fleet retries once per lease", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const store = memoryStore();
    const a = new CarbonFlagsProvider({ endpoint: url, store });
    const b = new CarbonFlagsProvider({ endpoint: url, store });
    await start(a);
    await start(b);
    expect(requests).toHaveLength(1);

    mode = "down";
    for (const value of store.data.values()) value.fetchedAt = 0;
    await a.refresh();
    await b.refresh();
    expect(requests).toHaveLength(2);
    expect(a.lastError).toMatch(/503/);
  });

  it("fetches the source when the store holds a copy it cannot load", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const store = memoryStore();
    await start(new CarbonFlagsProvider({ endpoint: url, store }));
    for (const value of store.data.values()) {
      value.body = '{"flags":{"x":{"state":"MAYBE"}}}';
      value.etag = '"bad"';
    }
    const read = await start(new CarbonFlagsProvider({ endpoint: url, store }));
    expect(await read("cmp_123")).toBe(true);
    // Every process on this scope runs the same flagd-core, so the fetch
    // repairs the shared copy.
    for (const value of store.data.values()) expect(value.etag).toBe('"v1"');
  });

  it("sends warnings to onWarning with structured properties", async () => {
    const warnings: [string, Record<string, unknown>][] = [];
    const provider = new CarbonFlagsProvider({
      endpoint: url,
      onWarning: (message, properties) => warnings.push([message, properties])
    });
    await start(provider);
    mode = "down";
    await provider.refresh();
    expect(warnings).toEqual([
      [
        "Feature flags kept after a failed sync",
        expect.objectContaining({ lastError: expect.stringMatching(/503/) })
      ]
    ]);
  });

  it("fetches the source directly when the store is unavailable", async () => {
    const read = await start(
      new CarbonFlagsProvider({ endpoint: url, store: unavailableStore })
    );
    expect(await read("cmp_123")).toBe(true);
  });

  it("loads a data: endpoint once and never fetches again", async () => {
    const provider = new CarbonFlagsProvider({
      endpoint: `data:application/json;base64,${Buffer.from(doc).toString("base64")}`
    });
    const read = await start(provider);
    expect(await read("cmp_123")).toBe(true);
    await read("cmp_123");
    expect(requests).toHaveLength(0);
  });

  it("refuses http: off localhost, so the token never goes out unencrypted", async () => {
    const warnings: string[] = [];
    const read = await start(
      new CarbonFlagsProvider({
        endpoint: "http://flags.example.com/api/flags",
        headers: "Authorization=Bearer%20secret",
        onWarning: (message) => warnings.push(message)
      })
    );
    expect(await read("cmp_123")).toBe(false);
    expect(warnings).toHaveLength(1);
  });

  it("refuses a file: endpoint with a warning and answers the defaults", async () => {
    const warnings: string[] = [];
    const provider = new CarbonFlagsProvider({
      endpoint: "file:///etc/carbon/flags.json",
      onWarning: (message) => warnings.push(message)
    });
    const read = await start(provider);
    expect(await read("cmp_123")).toBe(false);
    expect(warnings).toEqual([
      "CARBON_FLAGS_ENDPOINT must be an https: or data: URL (http: only on localhost); using the code defaults"
    ]);
  });

  it("warns once per archived flag that the code reads", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    doc = flagDoc(companyRule(["cmp_123"]), { archived: true });
    const read = await start(new CarbonFlagsProvider({ endpoint: url }));
    await read("cmp_123");
    await read("cmp_999");
    expect(
      warn.mock.calls.filter(([message]) =>
        String(message).includes("archived")
      )
    ).toHaveLength(1);
  });

  it("answers the default for a DISABLED flag", async () => {
    doc = JSON.stringify({
      flags: {
        "multi-company-management": {
          state: "DISABLED",
          variants: { on: true, off: false },
          defaultVariant: "on"
        }
      }
    });
    const read = await start(new CarbonFlagsProvider({ endpoint: url }));
    expect(await read("cmp_123")).toBe(false);
  });
});

describe("flags and evaluateBrowserFlags", () => {
  it("read the registry default and the evaluated value", async () => {
    expect(
      await flags.bool("multi-company-management", { companyId: "cmp_123" })
    ).toBe(false);

    await OpenFeature.setProviderAndWait(
      new CarbonFlagsProvider({ endpoint: url })
    );
    expect(
      await flags.bool("multi-company-management", { companyId: "cmp_123" })
    ).toBe(true);
    expect(
      await flags.bool("integration-early-access", { companyId: "cmp_123" })
    ).toBe(false);
    expect(await evaluateBrowserFlags({ companyId: "cmp_123" })).toEqual({
      "multi-company-management": true
    });
  });
  it("match a user rule by email, in lower case", async () => {
    const doc = JSON.stringify({
      flags: {
        "integration-early-access": {
          state: "ENABLED",
          variants: { on: true, off: false },
          defaultVariant: "off",
          targeting: {
            if: [
              {
                and: [
                  { "==": [{ var: "companyId" }, "cmp_A"] },
                  { in: [{ var: "email" }, ["raul@acme.com"]] }
                ]
              },
              "on",
              null
            ]
          }
        }
      }
    });
    await OpenFeature.setProviderAndWait(
      new CarbonFlagsProvider({
        endpoint: `data:application/json;base64,${Buffer.from(doc).toString("base64")}`
      })
    );
    const read = (companyId: string, email?: string) =>
      flags.bool("integration-early-access", { companyId, email });
    expect(await read("cmp_A", " Raul@Acme.com ")).toBe(true);
    expect(await read("cmp_B", "raul@acme.com")).toBe(false);
    expect(await read("cmp_A", "sid@acme.com")).toBe(false);
    expect(await read("cmp_A")).toBe(false);
  });
});
