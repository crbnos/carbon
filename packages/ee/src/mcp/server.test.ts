// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describeRequest } from "@carbon/logger/middleware.server";
import {
  annotateRequestSpan,
  nameRequestSpan,
  withSpan
} from "@carbon/logger/tracing.server";
import {
  Client,
  StreamableHTTPClientTransport
} from "@modelcontextprotocol/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireEntitlement } from "../entitlements.server";
import { serveMcpRequest } from "./server";
import type { McpCallResult } from "./types";

vi.mock("@carbon/logger/tracing.server", () => ({
  annotateRequestSpan: vi.fn(),
  nameRequestSpan: vi.fn(),
  withSpan: vi.fn((_name: string, _attributes: unknown, run: () => unknown) =>
    run()
  )
}));
vi.mock("@carbon/logger/middleware.server", () => ({
  describeRequest: vi.fn()
}));
vi.mock("../entitlements.server", () => ({
  requireEntitlement: vi.fn(async () => undefined)
}));

const callOperation = vi.fn(
  async (): Promise<McpCallResult> => ({
    success: true,
    data: [{ id: "cust_1" }]
  })
);

const ctx = {
  client: {},
  companyId: "co1",
  companyGroupId: "g1",
  userId: "u1"
} as never;

/**
 * A real MCP client talking HTTP to `serveMcpRequest`, the function the route
 * calls. `era` picks the protocol: "legacy" is the 2025 `initialize` handshake
 * every client uses by default; "modern" pins the 2026-07-28 revision.
 */
async function connect(
  entry: Record<string, unknown> = {
    name: "sales_getCustomer",
    module: "sales"
  },
  isList = false,
  era: "legacy" | "modern" = "legacy"
) {
  const deps = {
    callOperation,
    operationsByName: new Map([[entry.name, entry]]),
    isListOperation: () => isList,
    catalogSearch: { search: async () => ({ matches: [], total: 0 }) },
    toolMetadata: { tools: [{ module: "sales" }], totalTools: 1, modules: 1 }
  } as never;
  const transport = new StreamableHTTPClientTransport(
    new URL("https://carbon.test/api/mcp"),
    {
      fetch: (url, init) =>
        serveMcpRequest(new Request(url, init), ctx, "2026-10-01", deps)
    }
  );
  const client = new Client(
    { name: "test", version: "0.0.0" },
    {
      versionNegotiation: {
        mode: era === "modern" ? { pin: "2026-07-28" } : "legacy"
      }
    }
  );
  await client.connect(transport);
  return client;
}

describe("MCP tool calls are traced", () => {
  beforeEach(() => vi.clearAllMocks());

  it("names a call_tool span after the operation and still runs it", async () => {
    const client = await connect();

    const result = await client.callTool({
      name: "call_tool",
      arguments: { name: "sales_getCustomer", arguments: { customerId: "c" } }
    });

    expect(JSON.stringify(result.content)).toContain("cust_1");
    expect(callOperation).toHaveBeenCalledWith(
      "sales_getCustomer",
      expect.objectContaining({ companyId: "co1" }),
      expect.objectContaining({ customerId: "c" })
    );
    const attributes = {
      "carbon.mcp.tool": "call_tool",
      "carbon.operation": "sales_getCustomer"
    };
    expect(withSpan).toHaveBeenCalledWith(
      "mcp call_tool sales_getCustomer",
      attributes,
      expect.any(Function)
    );
    expect(annotateRequestSpan).toHaveBeenCalledWith(attributes);
    expect(nameRequestSpan).toHaveBeenCalledWith(
      "POST /api/mcp call_tool sales_getCustomer"
    );
    expect(describeRequest).toHaveBeenCalledWith("call_tool sales_getCustomer");
  });

  it("keeps a name the client made up out of the span name", async () => {
    const client = await connect();

    await client.callTool({
      name: "call_tool",
      arguments: { name: "not_a_real_operation", arguments: {} }
    });

    expect(withSpan).toHaveBeenCalledWith(
      "mcp call_tool",
      { "carbon.mcp.tool": "call_tool" },
      expect.any(Function)
    );
  });

  it("traces the other tools by their own name", async () => {
    const client = await connect();

    await client.callTool({ name: "search_tools", arguments: { query: "x" } });

    expect(withSpan).toHaveBeenCalledWith(
      "mcp search_tools",
      { "carbon.mcp.tool": "search_tools" },
      expect.any(Function)
    );
  });
});

describe("call_tool keeps list output small", () => {
  beforeEach(() => vi.clearAllMocks());

  it("clamps a paged read's limit, projects fields and names the next page", async () => {
    callOperation.mockResolvedValueOnce({
      success: true,
      data: [{ id: "cust_1", name: "Acme", fax: "x", notes: "long" }],
      count: 300
    });
    const client = await connect(
      { name: "sales_getCustomers", module: "sales", paginates: true },
      true
    );

    const result = await client.callTool({
      name: "call_tool",
      arguments: {
        name: "sales_getCustomers",
        arguments: { limit: 1000, offset: 40 },
        fields: ["id", "name"]
      }
    });

    expect(callOperation).toHaveBeenCalledWith(
      "sales_getCustomers",
      expect.anything(),
      { limit: 100, offset: 40 }
    );
    expect(result.content).toEqual([
      {
        type: "text",
        text: "# sales_getCustomers.csv\r\nid,name\r\ncust_1,Acme\n(rows 41-41 of 300; next page: offset 41)"
      }
    ]);
  });

  it("passes the caller's limit through with truncate false", async () => {
    callOperation.mockResolvedValueOnce({
      success: true,
      data: [{ id: "cust_1" }],
      count: 300
    });
    const client = await connect(
      { name: "sales_getCustomers", module: "sales", paginates: true },
      true
    );

    await client.callTool({
      name: "call_tool",
      arguments: {
        name: "sales_getCustomers",
        arguments: { limit: 500 },
        truncate: false
      }
    });

    expect(callOperation).toHaveBeenCalledWith(
      "sales_getCustomers",
      expect.anything(),
      { limit: 500, offset: 0 }
    );
  });

  it("pages a full-set read at the boundary with the clamped limit", async () => {
    callOperation.mockResolvedValueOnce({
      success: true,
      data: Array.from({ length: 250 }, (_, i) => ({ id: i }))
    });
    const client = await connect(
      { name: "sales_getCustomersList", module: "sales", paginates: false },
      true
    );

    const result = await client.callTool({
      name: "call_tool",
      arguments: {
        name: "sales_getCustomersList",
        arguments: { limit: 500, offset: 200 }
      }
    });

    const text = (result.content as { text: string }[])[0]!.text;
    const lines = text.split(/\r?\n/);
    expect(lines.slice(0, 3)).toEqual([
      "# sales_getCustomersList.csv",
      "id",
      "200"
    ]);
    expect(lines).not.toContain("199");
    expect(text).not.toContain("next page");
  });
});

describe("serveMcpRequest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("serves a 2026-07-28 client with the same tools", async () => {
    const client = await connect(undefined, false, "modern");
    expect(client.getNegotiatedProtocolVersion()).toBe("2026-07-28");
    expect(client.getInstructions()).toContain("search_tools");

    const result = await client.callTool({
      name: "call_tool",
      arguments: { name: "sales_getCustomer", arguments: { customerId: "c" } }
    });
    expect(result.content).toEqual([
      { type: "text", text: "# sales_getCustomer.csv\r\nid\r\ncust_1" }
    ]);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "call_destructive_tool",
      "call_tool",
      "describe_tool",
      "search_tools"
    ]);
  });

  it("answers a 2025 client with JSON, not an event stream", async () => {
    const response = await serveMcpRequest(
      new Request("https://carbon.test/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {}
        })
      }),
      ctx,
      "2026-10-01",
      {
        callOperation,
        operationsByName: new Map(),
        isListOperation: () => false,
        catalogSearch: { search: async () => ({ matches: [], total: 0 }) },
        toolMetadata: { tools: [], totalTools: 0, modules: 0 }
      } as never
    );
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = await response.json();
    expect(body.result.tools).toHaveLength(4);
  });

  it("refuses a subscription instead of holding the request open", async () => {
    const client = await connect(undefined, false, "modern");
    await expect(client.listen({ toolsListChanged: true })).rejects.toThrow(
      "Subscription limit reached"
    );
  });

  it("refuses an argument a strict input would drop, and passes a loose input's", async () => {
    const strict = await connect({
      name: "production_setJobOperationWorkInstruction",
      module: "production",
      schema: {
        type: "object",
        properties: { id: { type: "string" }, text: { type: "string" } }
      }
    });
    const refused = await strict.callTool({
      name: "call_tool",
      arguments: {
        name: "production_setJobOperationWorkInstruction",
        arguments: { id: "op_1", text: "Tap", assignee: "u2" }
      }
    });
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused.content)).toContain(
      "does not take assignee, so nothing was called. Its arguments: id, text."
    );
    expect(callOperation).not.toHaveBeenCalled();

    const loose = await connect({
      name: "purchasing_getPurchaseOrders",
      module: "purchasing",
      schema: {
        type: "object",
        properties: { search: { type: "string" } },
        additionalProperties: {}
      }
    });
    await loose.callTool({
      name: "call_tool",
      arguments: {
        name: "purchasing_getPurchaseOrders",
        arguments: { filters: [] }
      }
    });
    expect(callOperation).toHaveBeenCalledWith(
      "purchasing_getPurchaseOrders",
      expect.anything(),
      expect.objectContaining({ filters: [] })
    );
  });

  it("runs a DESTRUCTIVE tool only through call_destructive_tool", async () => {
    const client = await connect({
      name: "inventory_deleteReceipt",
      module: "inventory",
      classification: "DESTRUCTIVE"
    });
    const viaCallTool = await client.callTool({
      name: "call_tool",
      arguments: {
        name: "inventory_deleteReceipt",
        arguments: { receiptId: "r" }
      }
    });
    expect(viaCallTool.isError).toBe(true);
    expect(JSON.stringify(viaCallTool.content)).toContain(
      "call it with call_destructive_tool"
    );
    expect(callOperation).not.toHaveBeenCalled();

    const { tools } = await client.listTools();
    expect(
      tools.find((tool) => tool.name === "call_destructive_tool")?.annotations
        ?.destructiveHint
    ).toBe(true);
    await client.callTool({
      name: "call_destructive_tool",
      arguments: {
        name: "inventory_deleteReceipt",
        arguments: { receiptId: "r" }
      }
    });
    expect(callOperation).toHaveBeenCalledWith(
      "inventory_deleteReceipt",
      expect.anything(),
      { receiptId: "r" }
    );
  });

  it("names the closest tools for an unknown one instead of calling it", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "call_tool",
      arguments: { name: "sales_getCustomr", arguments: {} }
    });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      {
        type: "text",
        text: "Tool 'sales_getCustomr' not found. Did you mean: sales_getCustomer?"
      }
    ]);
    expect(callOperation).not.toHaveBeenCalled();
  });

  it("refuses before serving when the company is not entitled", async () => {
    vi.mocked(requireEntitlement).mockRejectedValueOnce(
      new Error("not entitled")
    );
    await expect(connect()).rejects.toThrow("not entitled");
    expect(callOperation).not.toHaveBeenCalled();
  });
});
