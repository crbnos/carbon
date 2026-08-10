import dns from "node:dns";
import type { Database } from "@carbon/database";
import { pairsValue, primitiveValue } from "@carbon/workflows";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWebhookAction } from "./webhook";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

// Only `fetch` is faked — `url-guard` needs the real `Agent` from the same module.
vi.mock("undici", async (importOriginal) => ({
  ...(await importOriginal<typeof import("undici")>()),
  fetch: fetchMock
}));

function fakeClient() {
  return {} as unknown as SupabaseClient<Database>;
}

function run(
  overrides: {
    body?: string;
    url?: string;
    method?: string;
    headers?: [string, string][];
  } = {}
) {
  return runWebhookAction({
    client: fakeClient(),
    companyId: "c1",
    workflowId: "wf1",
    inputs: {
      url: primitiveValue(
        "string",
        overrides.url ?? "https://example.com/hook"
      ),
      ...(overrides.method === undefined
        ? {}
        : { method: primitiveValue("string", overrides.method) }),
      ...(overrides.headers === undefined
        ? {}
        : {
            headers: pairsValue(
              overrides.headers.map(([name, value]) => ({
                name,
                value: primitiveValue("string", value)
              }))
            )
          }),
      ...(overrides.body === undefined
        ? {}
        : { body: primitiveValue("string", overrides.body) })
    }
  });
}

/** The request `fetch` was actually handed. */
function sent() {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
  return { init, headers: init.headers as Record<string, string> };
}

beforeEach(() => {
  vi.spyOn(dns.promises, "lookup").mockResolvedValue([
    { address: "93.184.216.34", family: 4 }
  ] as never);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response("thanks", { status: 200 }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runWebhookAction", () => {
  it("posts with a JSON content type when no method was chosen", async () => {
    const outcome = await run({ body: '{"hello":"world"}' });
    expect(outcome.ok).toBe(true);

    const { init, headers } = sent();
    expect(init.method).toBe("POST");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe('{"hello":"world"}');
  });

  it("goes out through the guarded dispatcher", async () => {
    await run();
    expect((sent().init as { dispatcher?: unknown }).dispatcher).toBeDefined();
  });

  it("sends no signing headers", async () => {
    await run({ body: "{}" });
    const { headers } = sent();
    expect(headers["Carbon-Signature"]).toBeUndefined();
    expect(headers["Carbon-Timestamp"]).toBeUndefined();
  });

  it("sends a GET with no body and no content type", async () => {
    await run({ method: "GET", body: "ignored" });
    const { init, headers } = sent();
    expect(init.method).toBe("GET");
    expect("body" in init).toBe(false);
    expect(headers["Content-Type"]).toBeUndefined();
  });

  it.each([
    "PUT",
    "PATCH",
    "DELETE"
  ])("sends a %s as itself", async (method) => {
    await run({ method });
    expect(sent().init.method).toBe(method);
  });

  it("lets a chosen content type win over the default", async () => {
    await run({
      method: "POST",
      body: "hi",
      headers: [["content-type", "text/plain"]]
    });
    const { headers } = sent();
    expect(headers["content-type"]).toBe("text/plain");
    expect(headers["Content-Type"]).toBeUndefined();
  });

  it("sends the headers the customer set", async () => {
    await run({ method: "GET", headers: [["Authorization", "Bearer abc"]] });
    expect(sent().headers.Authorization).toBe("Bearer abc");
  });

  it("drops the headers Carbon sets itself", async () => {
    await run({
      method: "GET",
      headers: [
        ["Host", "evil.example"],
        ["content-length", "9"],
        ["X-Keep", "yes"]
      ]
    });
    expect(sent().headers).toEqual({ "X-Keep": "yes" });
  });

  it("drops a row with no name and a row with no value", async () => {
    await run({
      method: "GET",
      headers: [
        ["  ", "orphan"],
        ["X-Empty", ""],
        ["X-Keep", "yes"]
      ]
    });
    expect(sent().headers).toEqual({ "X-Keep": "yes" });
  });

  it("lets a later row replace an earlier one of the same name", async () => {
    await run({
      method: "GET",
      headers: [
        ["X-Key", "first"],
        ["x-key", "second"]
      ]
    });
    expect(sent().headers).toEqual({ "x-key": "second" });
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
