import { describe, expect, it, vi } from "vitest";

const callOperation = vi.hoisted(() => vi.fn());

// call.server drags the full oRPC router (and with it every service module) in at
// module load — the agent's guard logic is what's under test, not the dispatch.
vi.mock("~/routes/api+/v1+/lib/call.server", () => ({ callOperation }));
// Data tools are gated off in v1; enable them so call_tool exists to test.
vi.mock("./agent.config", () => ({ AGENT_DATA_TOOLS_ENABLED: true }));

// agent.pages → ~/utils/path → @carbon/glossary, whose module-load-time Lingui `msg`
// macros aren't transformed under plain vitest and throw. The tools under test need
// none of it. Same stub as production.service.test.ts.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray | string, ...values: unknown[]) =>
    Array.isArray(strings)
      ? strings.reduce(
          (acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ""),
          ""
        )
      : String(strings)
}));

import type { AuthedContext } from "~/routes/api+/v1+/lib/base.server";
import { createAgentTools } from "./agent.tools";

const ctx: AuthedContext = {
  client: {} as AuthedContext["client"],
  companyId: "c1",
  companyGroupId: "g1",
  userId: "u1",
  authKind: "session",
  scopes: {}
};

const toolOptions = { toolCallId: "t1", messages: [] } as never;

function callTool(name: string, args?: Record<string, unknown>) {
  const tools = createAgentTools(ctx) as unknown as Record<
    string,
    { execute: (input: unknown, options: never) => Promise<unknown> }
  >;
  return tools.call_tool.execute({ name, arguments: args }, toolOptions);
}

describe("agent call_tool", () => {
  it("refuses a non-READ tool without reaching the dispatch", async () => {
    callOperation.mockClear();
    const result = await callTool("accounting_upsertAccount", {});
    expect(result).toEqual({
      error: 'Tool "accounting_upsertAccount" is not available.'
    });
    expect(callOperation).not.toHaveBeenCalled();
  });

  it("refuses a blocked tool without reaching the dispatch", async () => {
    callOperation.mockClear();
    const result = await callTool("settings_seedCompany", {});
    expect(result).toEqual({
      error: 'Tool "settings_seedCompany" is not available.'
    });
    expect(callOperation).not.toHaveBeenCalled();
  });

  it("forwards a READ tool to callOperation verbatim and returns its result unchanged", async () => {
    callOperation.mockClear();
    // Pins the intentional agent-facing change: the model sees UNWRAPPED data
    // ({ success, data, count }), not the raw Supabase envelope.
    const dispatchResult = {
      success: true,
      data: [{ id: "e1" }],
      count: 1
    };
    callOperation.mockResolvedValue(dispatchResult);

    const args = { args: { limit: 1 } };
    const result = await callTool("accounting_getAccountLedger", args);

    expect(callOperation).toHaveBeenCalledTimes(1);
    expect(callOperation).toHaveBeenCalledWith(
      "accounting_getAccountLedger",
      ctx,
      args
    );
    expect(result).toBe(dispatchResult);
  });
});
