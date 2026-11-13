// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";

const authorize = vi.hoisted(() => vi.fn());
vi.mock("@carbon/auth/auth.server", () => ({ authorize }));

import { action, loader } from "./authorize";

// The membership read: the one table both handlers query first.
const client = {
  from: () => {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      single: async () => ({ data: null, error: null }),
      then: (resolve: (value: unknown) => unknown) =>
        resolve({ data: [], error: null })
    };
    return chain;
  }
};

function callerIs(caller: "session" | "apiKey") {
  authorize.mockResolvedValue({
    caller,
    client,
    companyId: "company-1",
    userId: "user-1"
  });
}

const url =
  "https://erp.example.com/oauth/authorize?response_type=code&client_id=c&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcb";

async function refusal(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (thrown) {
    return thrown as Response;
  }
  return null;
}

// A key acts as its creator: consenting with one would issue an OAuth token
// carrying the creator's full access, above the key's own grants.
describe("OAuth consent", () => {
  beforeEach(() => authorize.mockReset());

  it("refuses an API key on the consent screen", async () => {
    callerIs("apiKey");
    const thrown = await refusal(() =>
      loader({ request: new Request(url) } as never)
    );
    expect(thrown?.status).toBe(403);
  });

  it("refuses an API key granting consent", async () => {
    callerIs("apiKey");
    const request = new Request(url, {
      method: "POST",
      body: new URLSearchParams({ company_id: "company-1" })
    });
    const thrown = await refusal(() => action({ request } as never));
    expect(thrown?.status).toBe(403);
  });

  it("lets a signed-in person reach the consent form", async () => {
    callerIs("session");
    const request = new Request(url, {
      method: "POST",
      body: new URLSearchParams({ company_id: "company-1" })
    });
    const result = (await action({ request } as never)) as {
      init: { status: number } | null;
    };
    // Past the gate, the company check answers: user-1 is no member here.
    expect(result.init?.status).toBe(403);
    expect(authorize).toHaveBeenCalledWith(request, {
      "settings.apiKeys": "Edit"
    });
  });
});
