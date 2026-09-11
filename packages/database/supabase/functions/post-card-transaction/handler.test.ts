import { assertEquals } from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { handlePostCardTransaction } from "./handler.ts";

const companyId = "card-auth-company";
const serviceToken = `header.${
  btoa(JSON.stringify({ role: "service_role" }))
}.signature`;

async function withAuthTransport(
  scopes: Record<string, string[]>,
  run: () => Promise<void>,
) {
  const originalFetch = globalThis.fetch;
  const variables = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const previous = variables.map((key) => Deno.env.get(key));
  Deno.env.set("SUPABASE_URL", "http://auth.invalid");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", serviceToken);
  globalThis.fetch = (input) => {
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
    );
    if (url.pathname === "/rest/v1/apiKey") {
      return Promise.resolve(Response.json({
        id: "card-auth-key",
        companyId,
        scopes,
        rateLimit: 60,
        rateLimitWindow: "1m",
        expiresAt: null,
      }));
    }
    if (url.pathname === "/rest/v1/rpc/check_api_key_rate_limit") {
      return Promise.resolve(Response.json({
        success: true,
        count: 1,
        limit: 60,
        remaining: 59,
        resetAt: 0,
      }));
    }
    throw new Error(`Unexpected auth request: ${url.pathname}`);
  };
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    variables.forEach((key, index) => {
      const value = previous[index];
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    });
  }
}

for (const type of ["post", "void"] as const) {
  Deno.test(`${type} refuses an API key without invoicing update before posting`, async () => {
    await withAuthTransport({ invoicing_view: [companyId] }, async () => {
      let posts = 0;
      const response = await handlePostCardTransaction(
        new Request("http://localhost/post-card-transaction", {
          method: "POST",
          headers: { "carbon-key": "read-only-key" },
          body: JSON.stringify({
            type,
            companyId,
            userId: "system",
            cardTransactionId: "card-1",
          }),
        }),
        () => {
          posts++;
          return Promise.resolve({ journalId: "journal-1" });
        },
      );
      assertEquals(await response.json(), {
        message: "API key lacks required permissions",
      });
      assertEquals(response.status, 500);
      assertEquals(posts, 0);
    });
  });
}

Deno.test("service-role jobs and scoped invoicing API keys can post", async () => {
  await withAuthTransport({ invoicing_update: [companyId] }, async () => {
    for (
      const headers of [
        new Headers({ Authorization: `Bearer ${serviceToken}` }),
        new Headers({ "carbon-key": "invoicing-key" }),
      ]
    ) {
      const response = await handlePostCardTransaction(
        new Request("http://localhost/post-card-transaction", {
          method: "POST",
          headers,
          body: JSON.stringify({
            companyId,
            userId: "system",
            cardTransactionId: "card-1",
          }),
        }),
        (args) => {
          assertEquals(args.companyId, companyId);
          return Promise.resolve({ journalId: "journal-1" });
        },
      );
      assertEquals(await response.json(), {
        success: true,
        journalId: "journal-1",
      });
      assertEquals(response.status, 200);
    }
  });
});
