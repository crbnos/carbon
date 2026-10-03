// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describeRequest } from "@carbon/logger/middleware.server";
import {
  annotateRequestSpan,
  nameRequestSpan,
  withSpan
} from "@carbon/logger/tracing.server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMcpServer } from "./server";

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

const callOperation = vi.fn(async () => ({
  success: true as const,
  data: [{ id: "cust_1" }]
}));

async function connect() {
  const server = await createMcpServer(
    {
      client: {},
      companyId: "co1",
      companyGroupId: "g1",
      userId: "u1"
    } as never,
    "2026-10-01",
    {
      callOperation,
      operationsByName: new Map([
        ["sales_getCustomer", { name: "sales_getCustomer", module: "sales" }]
      ]),
      isListOperation: () => false,
      isMcpBlockedTool: () => false,
      catalogSearch: { search: async () => ({ matches: [], total: 0 }) },
      toolMetadata: { tools: [{ module: "sales" }], totalTools: 1, modules: 1 }
    } as never
  );
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientSide);
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
