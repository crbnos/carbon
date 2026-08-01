import dns from "node:dns";
import type { Database } from "@carbon/database";
import { primitiveValue } from "@carbon/workflows";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWebhookAction } from "./webhook";

function fakeClient() {
  return {} as unknown as SupabaseClient<Database>;
}

function run(overrides: { body?: string; url?: string } = {}) {
  return runWebhookAction({
    client: fakeClient(),
    companyId: "c1",
    workflowId: "wf1",
    inputs: {
      url: primitiveValue(
        "string",
        overrides.url ?? "https://example.com/hook"
      ),
      ...(overrides.body === undefined
        ? {}
        : { body: primitiveValue("string", overrides.body) })
    }
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.spyOn(dns.promises, "lookup").mockResolvedValue([
    { address: "93.184.216.34", family: 4 }
  ] as never);
  fetchMock = vi.fn(async () => new Response("thanks", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("runWebhookAction", () => {
  it("sends no signing headers", async () => {
    const outcome = await run({ body: '{"hello":"world"}' });
    expect(outcome.ok).toBe(true);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["Carbon-Signature"]).toBeUndefined();
    expect(headers["Carbon-Timestamp"]).toBeUndefined();
  });

  it("hands back the status and an excerpt of the answer", async () => {
    const outcome = await run();
    expect(outcome).toEqual({
      ok: true,
      outputs: { status: primitiveValue("number", 200) },
      summary: "Answered 200: thanks"
    });
  });

  it("refuses a redirect rather than following it", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 302 }));
    expect(await run()).toEqual({
      ok: false,
      error: "That address redirected, which is not allowed."
    });
  });

  it("refuses a server error", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
    expect(await run()).toEqual({
      ok: false,
      error: "The address answered 500."
    });
  });

  it("refuses a network failure", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    expect(await run()).toEqual({
      ok: false,
      error: "The address could not be reached."
    });
  });

  it("refuses an address the guard rejects, without calling out", async () => {
    expect(await run({ url: "http://example.com" })).toEqual({
      ok: false,
      error: "Only https addresses are allowed."
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks for a web address when none was supplied", async () => {
    const outcome = await runWebhookAction({
      client: fakeClient(),
      companyId: "c1",
      workflowId: "wf1",
      inputs: {}
    });
    expect(outcome).toEqual({
      ok: false,
      error: "This step needs a web address to call."
    });
  });
});
