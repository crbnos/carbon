// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ServerFnError } from "@carbon/api/errors";
import { verifyInternalCall } from "@carbon/api/internal-call";
import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

// `@carbon/auth`'s barrel reaches components whose Lingui macros only run compiled.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray) => ({ id: strings.join("") })
}));

const { erpPosting, erpPostingUrl } = await import("./erp");

// SESSION_SECRET and SUPABASE_SERVICE_ROLE_KEY as vitest.config.ts sets them.
const SECRET = "test";
const companyId = "c1";
const userId = "u1";
const input = { type: "jobRequirements" as const, id: "job1" };

/** The ERP, at the network boundary: records what it was sent. */
function erp(answer: Response) {
  const sent: Request[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      sent.push(new Request(url, init));
      return answer;
    })
  );
  return sent;
}

afterEach(() => vi.unstubAllGlobals());

describe("erpPosting", () => {
  it("signs a system call the ERP can verify", async () => {
    const sent = erp(Response.json({ data: { success: true }, error: null }));
    const result = await erpPosting(
      "recalculate",
      { companyId, userId },
      input
    );
    expect(result).toEqual({ data: { success: true }, error: null });

    const request = sent[0]!;
    expect(new URL(request.url).pathname).toBe(
      "/api/internal/postings/recalculate"
    );
    const call = verifyInternalCall(
      SECRET,
      "recalculate",
      request.headers,
      await request.text()
    );
    expect(call).toMatchObject({ companyId, userId, mode: "system" });
  });

  it("runs as the system for a service-role client", async () => {
    const sent = erp(Response.json({ data: { success: true }, error: null }));
    const serviceRole = createClient("http://localhost", "test");
    await erpPosting(
      "recalculate",
      { companyId, userId, client: serviceRole },
      input
    );
    expect(sent[0]!.headers.get("x-carbon-mode")).toBe("system");
    expect(sent[0]!.headers.get("authorization")).toBeNull();
  });

  it("forwards a user's token and signs it in caller mode", async () => {
    const sent = erp(Response.json({ data: { success: true }, error: null }));
    const user = createClient("http://localhost", "anon-key", {
      global: { headers: { Authorization: "Bearer user-token" } }
    });
    await erpPosting("recalculate", { companyId, userId, client: user }, input);
    const request = sent[0]!;
    expect(request.headers.get("authorization")).toBe("Bearer user-token");
    expect(
      verifyInternalCall(
        SECRET,
        "recalculate",
        request.headers,
        await request.text()
      )
    ).toMatchObject({ mode: "caller" });
  });

  it("returns the ERP's refusal as a ServerFnError with its status and body", async () => {
    erp(
      Response.json(
        {
          data: null,
          error: { status: 409, message: "Already posted", body: { code: "x" } }
        },
        { status: 409 }
      )
    );
    const { data, error } = await erpPosting(
      "recalculate",
      { companyId, userId },
      input
    );
    expect(data).toBeNull();
    expect(error).toBeInstanceOf(ServerFnError);
    expect(error).toMatchObject({
      status: 409,
      message: "Already posted",
      body: { code: "x" }
    });
  });

  it("calls a set-up problem a configuration error, and sends nothing", async () => {
    const sent = erp(Response.json({ data: { success: true }, error: null }));
    const signedOut = createClient("http://localhost", "anon-key");
    const { error } = await erpPosting(
      "recalculate",
      { companyId, userId, client: signedOut },
      input
    );
    expect(error).toMatchObject({ status: 500 });
    expect(error?.message).toMatch(/not configured/);
    expect(sent).toHaveLength(0);
  });

  it("posts to ERP_URL, else only to a known ERP", () => {
    expect(erpPostingUrl("https://erp.example.com", "other")).toBe(
      "https://erp.example.com"
    );
    expect(erpPostingUrl(undefined, "local")).toBe("http://localhost:3000");
    expect(erpPostingUrl(undefined, "cloud")).toBe("https://app.carbon.ms");
    expect(() => erpPostingUrl(undefined, "other")).toThrow(/ERP_URL/);
  });

  it("answers 502 when the ERP is unreachable or not the ERP", async () => {
    erp(new Response("<html>Bad gateway</html>", { status: 502 }));
    expect(
      (await erpPosting("recalculate", { companyId, userId }, input)).error
    ).toMatchObject({ status: 502 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );
    expect(
      (await erpPosting("recalculate", { companyId, userId }, input)).error
    ).toMatchObject({ status: 502 });
  });
});
