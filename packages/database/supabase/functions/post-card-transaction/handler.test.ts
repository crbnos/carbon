import { assertEquals } from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { handlePostCardTransaction } from "./handler.ts";

const companyId = "card-auth-company";
const serviceToken = `header.${
  btoa(JSON.stringify({ role: "service_role" }))
}.signature`;
const authenticatedToken = `header.${
  btoa(JSON.stringify({ role: "authenticated", sub: "attacker-user" }))
}.signature`;

async function withAuthTransport(
  scopes: Record<string, string[]>,
  run: () => Promise<void>,
  authenticatedClaims?: Record<string, unknown>,
) {
  const originalFetch = globalThis.fetch;
  const originalEnvGet = Deno.env.get;
  const testEnv = new Map([
    ["SUPABASE_URL", "http://auth.invalid"],
    ["SUPABASE_SERVICE_ROLE_KEY", serviceToken],
  ]);
  Deno.env.get = (key) => testEnv.get(key);
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
    if (
      url.pathname === "/rest/v1/rpc/get_claims" && authenticatedClaims
    ) {
      return Promise.resolve(Response.json(authenticatedClaims));
    }
    throw new Error(`Unexpected auth request: ${url.pathname}`);
  };
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.get = originalEnvGet;
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

Deno.test("authenticated callers cannot borrow another user's permissions", async () => {
  await withAuthTransport({}, async () => {
    let posts = 0;
    const response = await handlePostCardTransaction(
      new Request("http://localhost/post-card-transaction", {
        method: "POST",
        headers: { Authorization: `Bearer ${authenticatedToken}` },
        body: JSON.stringify({
          companyId,
          userId: "privileged-user",
          cardTransactionId: "card-1",
        }),
      }),
      () => {
        posts++;
        return Promise.resolve({ journalId: "journal-1" });
      },
    );

    assertEquals(await response.json(), {
      message: "Authenticated user does not match requested user",
    });
    assertEquals(response.status, 500);
    assertEquals(posts, 0);
  }, { invoicing_update: [companyId] });
});

Deno.test("authenticated callers can post as their JWT subject", async () => {
  await withAuthTransport({}, async () => {
    const response = await handlePostCardTransaction(
      new Request("http://localhost/post-card-transaction", {
        method: "POST",
        headers: { Authorization: `Bearer ${authenticatedToken}` },
        body: JSON.stringify({
          companyId,
          userId: "attacker-user",
          cardTransactionId: "card-1",
        }),
      }),
      (args) => {
        assertEquals(args.userId, "attacker-user");
        return Promise.resolve({ journalId: "journal-1" });
      },
    );

    assertEquals(await response.json(), {
      success: true,
      journalId: "journal-1",
    });
    assertEquals(response.status, 200);
  }, { invoicing_update: [companyId] });
});
