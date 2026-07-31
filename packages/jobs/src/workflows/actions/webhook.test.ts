import { createHmac } from "node:crypto";
import dns from "node:dns";
import type { Database } from "@carbon/database";
import { primitiveValue } from "@carbon/workflows";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWebhookAction } from "./webhook";

const SECRET = "b16b00b5";

/** Just enough of the chain for `.from().select().eq().eq().single()`. */
function fakeClient(webhookSecret: string | null) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    single: async () =>
      webhookSecret === null
        ? { data: null, error: { message: "no row" } }
        : { data: { webhookSecret }, error: null }
  };
  return { from: () => chain } as unknown as SupabaseClient<Database>;
}

function run(
  overrides: { body?: string; url?: string; secret?: string | null } = {}
) {
  return runWebhookAction({
    client: fakeClient(
      overrides.secret === undefined ? SECRET : overrides.secret
    ),
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
  it("signs the exact bytes it sends", async () => {
    const outcome = await run({ body: '{"hello":"world"}' });
    expect(outcome.ok).toBe(true);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    const timestamp = headers["Carbon-Timestamp"];
    const expected = createHmac("sha256", SECRET)
      .update(`v1:${timestamp}:${init.body as string}`)
      .digest("hex");

    expect(init.body).toBe('{"hello":"world"}');
    expect(headers["Carbon-Signature"]).toBe(`v1=${expected}`);
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("hands back the status and an excerpt of the answer", async () => {
    const outcome = await run();
    expect(outcome).toEqual({
      ok: true,
      outputs: { status: primitiveValue("number", 200) },
      summary: "Answered 200: thanks"
    });
  });

  it("never puts the secret or the signature in the summary", async () => {
    const outcome = await run();
    expect(JSON.stringify(outcome)).not.toContain(SECRET);
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

  it("refuses when the workflow has no signing secret", async () => {
    expect(await run({ secret: null })).toEqual({
      ok: false,
      error: "This workflow has no signing secret."
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks for a web address when none was supplied", async () => {
    const outcome = await runWebhookAction({
      client: fakeClient(SECRET),
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
