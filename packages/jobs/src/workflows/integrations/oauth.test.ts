import { describe, expect, it, vi } from "vitest";

// Read by NAME off the allowlist row, so the mock is a bag of env vars rather
// than fixed exports — that indirection is the thing under test.
const ENV: Record<string, string | undefined> = {
  GOOGLE_OAUTH_CLIENT_ID: "client-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
  GOOGLE_OAUTH_REDIRECT_URL:
    "https://erp.test/api/integrations/connections/callback"
};

vi.mock("@carbon/env", () => ({
  getEnv: (name: string) => ENV[name]
}));

const {
  accountLabelFromBody,
  buildConsentUrl,
  connectionMetadataFrom,
  requiredScopesFor,
  resolveOAuthApp
} = await import("./oauth");
const { PIECE_ALLOWLIST } = await import("./allowlist");
const { getPieceOAuth2Auth } = await import("./registry");

describe("resolveOAuthApp", () => {
  it("reads the app from the env vars the allowlist row names", () => {
    expect(resolveOAuthApp("google-calendar")).toEqual({
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUrl: "https://erp.test/api/integrations/connections/callback"
    });
  });

  it("refuses a piece that is not allowlisted", () => {
    expect(() => resolveOAuthApp("notion")).toThrow(
      "No OAuth app is configured for notion."
    );
  });

  it("refuses when the server has not configured the app", () => {
    ENV.GOOGLE_OAUTH_CLIENT_SECRET = undefined;
    try {
      // A half-configured vendor must fail here, not send the customer to a
      // consent screen that cannot come back.
      expect(() => resolveOAuthApp("google-calendar")).toThrow(
        "No OAuth app is configured for google-calendar."
      );
    } finally {
      ENV.GOOGLE_OAUTH_CLIENT_SECRET = "client-secret";
    }
  });
});

describe("buildConsentUrl", () => {
  const app = { clientId: "c", redirectUrl: "https://erp.test/cb" };
  const oauth = {
    clientIdEnv: "X_ID",
    clientSecretEnv: "X_SECRET",
    redirectUrlEnv: "X_REDIRECT"
  };

  it("uses the piece's own authUrl and scope when the row overrides nothing", () => {
    const url = new URL(
      buildConsentUrl({
        entry: { oauth },
        auth: { authUrl: "https://v.example/auth?x=1", scope: ["a", "b"] },
        app,
        state: "s"
      })
    );
    expect(url.origin + url.pathname).toBe("https://v.example/auth");
    expect(url.searchParams.get("x")).toBe("1");
    expect(url.searchParams.get("scope")).toBe("a b");
    expect(url.searchParams.get("client_id")).toBe("c");
    expect(url.searchParams.get("redirect_uri")).toBe("https://erp.test/cb");
    expect(url.searchParams.get("state")).toBe("s");
  });

  // Slack's piece bakes a user-token request into its URL; the override drops it.
  it("lets the row replace the authUrl and the scope", () => {
    const url = new URL(
      buildConsentUrl({
        entry: {
          oauth: {
            ...oauth,
            authUrl: "https://slack.com/oauth/v2/authorize",
            scope: ["chat:write"]
          }
        },
        auth: {
          authUrl:
            "https://slack.com/oauth/v2/authorize?user_scope=search:read",
          scope: ["chat:write", "channels:manage"]
        },
        app,
        state: "s"
      })
    );
    expect(url.searchParams.has("user_scope")).toBe(false);
    expect(url.searchParams.get("scope")).toBe("chat:write");
  });

  it("asks Slack for the sixteen bot scopes and no user token", async () => {
    const url = new URL(
      buildConsentUrl({
        entry: PIECE_ALLOWLIST.slack!,
        auth: await getPieceOAuth2Auth("slack"),
        app,
        state: "s"
      })
    );
    expect(url.searchParams.has("user_scope")).toBe(false);
    const scopes = url.searchParams.get("scope")!.split(" ");
    expect(new Set(scopes).size).toBe(16);
    expect(scopes).toContain("chat:write.public");
    expect(scopes).toContain("incoming-webhook");
    expect(scopes).toContain("channels:read");
  });

  it("asks Google for send-only Gmail scopes, offline, with forced consent", async () => {
    const url = new URL(
      buildConsentUrl({
        entry: PIECE_ALLOWLIST.gmail!,
        auth: await getPieceOAuth2Auth("gmail"),
        app,
        state: "s"
      })
    );
    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/auth"
    );
    expect(url.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email"
    );
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });
});

describe("connection metadata", () => {
  const body = {
    ok: true,
    access_token: "xoxb-1",
    scope: "chat:write,commands",
    bot_user_id: "U1",
    team: { id: "T1", name: "Acme" },
    incoming_webhook: {
      channel: "#ops",
      channel_id: "C1",
      url: "https://hooks.slack.com/x",
      configuration_url: "https://acme.slack.com/services/B1"
    }
  };

  it("picks exactly the declared paths, never the token", () => {
    const picked = connectionMetadataFrom(PIECE_ALLOWLIST.slack!, body);
    expect(picked).toEqual({
      team_id: "T1",
      team_name: "Acme",
      bot_user_id: "U1",
      channel: "#ops",
      channel_id: "C1",
      scopes: "chat:write,commands"
    });
    expect(picked).not.toHaveProperty("access_token");
    // A webhook URL lets anyone post to the channel — never on a row admins can read.
    expect(picked).not.toHaveProperty("webhook_url");
  });

  it("omits paths the response does not carry", () => {
    const { incoming_webhook: _omitted, ...withoutWebhook } = body;
    const picked = connectionMetadataFrom(
      PIECE_ALLOWLIST.slack!,
      withoutWebhook
    );
    for (const gone of ["channel", "channel_id"]) {
      expect(picked).not.toHaveProperty(gone);
    }
    expect(picked.team_id).toBe("T1");
  });

  it("is empty for a row that declares nothing", () => {
    expect(connectionMetadataFrom({ metadata: undefined }, body)).toEqual({});
  });

  it("reads the account label off the response only when the row says so", () => {
    expect(accountLabelFromBody(PIECE_ALLOWLIST.slack!, body)).toBe("Acme");
    expect(
      accountLabelFromBody(PIECE_ALLOWLIST["google-calendar"]!, body)
    ).toBeNull();
  });
});

describe("requiredScopesFor", () => {
  it("is the row's override when it has one", async () => {
    const scopes = await requiredScopesFor("slack");
    expect(new Set(scopes).size).toBe(16);
    expect(scopes).toContain("channels:read");
  });

  // Google's pieces end their lists in the alias `email`; Google grants it as
  // `…/auth/userinfo.email`. The row spells it canonically so granted-vs-required
  // matches; the SET of permissions asked for is unchanged.
  it("spells Calendar's scopes canonically, asking for nothing the piece does not", async () => {
    const canonical = (scope: string) =>
      scope === "email"
        ? "https://www.googleapis.com/auth/userinfo.email"
        : scope;
    expect([...(await requiredScopesFor("google-calendar"))].sort()).toEqual(
      (await getPieceOAuth2Auth("google-calendar")).scope.map(canonical).sort()
    );
  });

  // Pitfall 2 in allowlist.ts: a short alias never matches what Google reports as
  // granted, so the account would read "Reconnect needed" from its first second.
  it("never lists a Google scope alias on any row", async () => {
    for (const piece of Object.keys(PIECE_ALLOWLIST)) {
      for (const scope of await requiredScopesFor(piece)) {
        expect(["email", "profile", "openid"]).not.toContain(scope);
      }
    }
  });

  it("is empty for a piece that is not allowlisted", async () => {
    expect(await requiredScopesFor("nope")).toEqual([]);
  });

  it("is send-only for gmail, never the piece's restricted scopes", async () => {
    const scopes = await requiredScopesFor("gmail");
    expect(scopes).toEqual([
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/userinfo.email"
    ]);
  });
});
