import type { Database } from "@carbon/database";
import type { RuntimeValue } from "@carbon/workflows";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { redactForLog } from "../engine/ledger";

const COMPANY = "cmp_1";
const CONNECTION = "icn_1";

const resolveConnectionAuth = vi.fn();
const readConnection = vi.fn();
const getPieceAction = vi.fn();

class FakeRevoked extends Error {}
class FakeSecretUnavailable extends Error {}
class FakeRefreshTimeout extends Error {}

vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => ({}) as SupabaseClient<Database>
}));

// The OAuth app is looked up by the env var NAMES on the allowlist row, so the
// mock answers `getEnv` rather than exporting fixed constants.
const ENV: Record<string, string> = {
  GOOGLE_OAUTH_CLIENT_ID: "client-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
  GOOGLE_OAUTH_REDIRECT_URL:
    "https://erp.test/api/integrations/connections/callback",
  SLACK_CLIENT_ID: "slack-client-id",
  SLACK_CLIENT_SECRET: "slack-client-secret",
  SLACK_OAUTH_REDIRECT_URL: "https://erp.test/api/integrations/slack/oauth"
};

vi.mock("@carbon/env", () => ({
  getEnv: (name: string) => ENV[name]
}));

// The real `missingScopes` runs — it is part of what this module does.
vi.mock("@carbon/ee/integrations/connections", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@carbon/ee/integrations/connections")
  >()),
  ConnectionRevokedError: FakeRevoked,
  ConnectionSecretUnavailableError: FakeSecretUnavailable,
  ConnectionRefreshTimeoutError: FakeRefreshTimeout,
  readConnection: (...args: unknown[]) => readConnection(...args),
  resolveConnectionAuth: (...args: unknown[]) => resolveConnectionAuth(...args)
}));

vi.mock("../integrations/registry", () => ({
  getPieceAction: (...args: unknown[]) => getPieceAction(...args),
  getPieceOAuth2Auth: async () => ({
    type: "OAUTH2",
    authUrl: "https://accounts.google.com/o/oauth2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: []
  })
}));

const { runIntegrationAction } = await import("./integration");

const client = {} as SupabaseClient<Database>;

const inputs = (extra: Record<string, RuntimeValue> = {}) => ({
  connectionId: {
    kind: "primitive" as const,
    of: "string" as const,
    value: CONNECTION
  },
  title: {
    kind: "primitive" as const,
    of: "string" as const,
    value: "Kickoff"
  },
  ...extra
});

const run = (
  overrides: Partial<Parameters<typeof runIntegrationAction>[0]> = {}
) =>
  runIntegrationAction({
    client,
    companyId: COMPANY,
    pieceName: "google-calendar",
    actionName: "create_google_calendar_event",
    inputs: inputs(),
    ...overrides
  });

describe("runIntegrationAction", () => {
  beforeEach(() => {
    readConnection.mockResolvedValue({
      id: CONNECTION,
      pieceName: "google-calendar",
      metadata: {}
    });
    resolveConnectionAuth.mockResolvedValue({ accessToken: "at-1" });
    getPieceAction.mockResolvedValue({
      name: "create_google_calendar_event",
      displayName: "Create Event",
      props: { title: { type: "SHORT_TEXT", required: true } },
      run: async () => ({ id: "evt_1" })
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("runs the piece with the fresh token and reports what it made", async () => {
    const outcome = await run();
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.outputs.result).toEqual({
      kind: "primitive",
      of: "string",
      value: JSON.stringify({ id: "evt_1" })
    });
  });

  it("passes only the action's own props to the piece", async () => {
    let received: unknown;
    getPieceAction.mockResolvedValue({
      name: "create_google_calendar_event",
      displayName: "Create Event",
      props: { title: { type: "SHORT_TEXT", required: true } },
      run: async (context: { propsValue: unknown }) => {
        received = context.propsValue;
        return "ok";
      }
    });

    await run();
    expect(received).toEqual({ title: "Kickoff" });
  });

  it("refuses when no connection was chosen", async () => {
    const outcome = await run({
      inputs: {
        title: { kind: "primitive", of: "string", value: "Kickoff" }
      }
    });
    expect(outcome).toEqual({
      ok: false,
      error: "This step needs a connection."
    });
  });

  // A Slack workspace connected for the Assistant before the piece existed holds
  // 10 scopes, not 16. Fail before the vendor call, with words that name the fix.
  it("refuses before calling the vendor when the account lacks a required scope", async () => {
    readConnection.mockResolvedValue({
      id: CONNECTION,
      pieceName: "slack",
      metadata: { scopes: "chat:write,commands" }
    });
    const piece = vi.fn(async () => ({ ok: true }));
    getPieceAction.mockResolvedValue({
      name: "send_channel_message",
      displayName: "Send Message To A Channel",
      props: {},
      run: piece
    });
    const outcome = await run({
      pieceName: "slack",
      actionName: "send_channel_message"
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? "" : outcome.error).toMatch(
      /reconnected .*Accounts → Reconnect/
    );
    expect(piece).not.toHaveBeenCalled();
    expect(resolveConnectionAuth).not.toHaveBeenCalled();
  });

  // The omit exists to keep the user-token path unreachable; a node saved before
  // the omit landed (or posted by hand) must not reopen it.
  it("never sends an omitted prop, even when the node carries a value", async () => {
    readConnection.mockResolvedValue({
      id: CONNECTION,
      pieceName: "slack",
      metadata: {}
    });
    const piece = vi.fn(async (_ctx: unknown) => ({ ok: true }));
    getPieceAction.mockResolvedValue({
      name: "send_channel_message",
      displayName: "Send Message To A Channel",
      props: {
        text: { type: "LONG_TEXT", required: false },
        sendAsBot: { type: "CHECKBOX", required: true, defaultValue: true }
      },
      run: piece
    });
    await run({
      pieceName: "slack",
      actionName: "send_channel_message",
      inputs: inputs({
        sendAsBot: { kind: "primitive", of: "boolean", value: false }
      })
    });
    expect(piece).toHaveBeenCalledTimes(1);
    const ctx = piece.mock.calls[0]?.[0] as {
      propsValue: Record<string, unknown>;
    };
    expect(ctx.propsValue.sendAsBot).toBe(true);
  });

  it("maps a vendor scope error to the reconnect copy", async () => {
    getPieceAction.mockResolvedValue({
      name: "create_google_calendar_event",
      displayName: "Create Event",
      props: { title: { type: "SHORT_TEXT", required: true } },
      run: async () => {
        throw new Error("An API error occurred: missing_scope");
      }
    });
    const outcome = await run();
    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? "" : outcome.error).toMatch(/needs to be reconnected/);
  });

  it("refuses a connection belonging to another piece", async () => {
    readConnection.mockResolvedValue({
      id: CONNECTION,
      pieceName: "slack",
      metadata: {}
    });
    const outcome = await run();
    expect(outcome).toEqual({
      ok: false,
      error: "This step needs a connection."
    });
  });

  it("asks the customer to reconnect when the connection is revoked", async () => {
    resolveConnectionAuth.mockRejectedValue(new FakeRevoked("gone"));
    expect(await run()).toEqual({
      ok: false,
      error: "The Google Calendar connection needs to be reconnected."
    });
  });

  it("asks the customer to reconnect when the token cannot be read", async () => {
    resolveConnectionAuth.mockRejectedValue(new FakeSecretUnavailable("gone"));
    expect(await run()).toEqual({
      ok: false,
      error: "The Google Calendar connection needs to be reconnected."
    });
  });

  it("says to try again when another worker holds the refresh", async () => {
    resolveConnectionAuth.mockRejectedValue(new FakeRefreshTimeout("busy"));
    expect(await run()).toEqual({
      ok: false,
      error: "The Google Calendar connection was busy refreshing. Try again."
    });
  });

  it("reports an unavailable connection for anything else", async () => {
    resolveConnectionAuth.mockRejectedValue(new Error("network"));
    expect(await run()).toEqual({
      ok: false,
      error: "The Google Calendar connection is unavailable."
    });
  });

  it("reports the vendor's own message when the API rejects the call", async () => {
    getPieceAction.mockResolvedValue({
      name: "create_google_calendar_event",
      displayName: "Create Event",
      props: {},
      run: async () => {
        throw new Error("Invalid attendee email");
      }
    });
    expect(await run()).toEqual({
      ok: false,
      error: "Google Calendar rejected this: Invalid attendee email"
    });
  });
});

describe("run-history redaction", () => {
  it("keeps no token out of a step's recorded input", () => {
    const recorded = redactForLog({
      connectionId: CONNECTION,
      access_token: "at-1",
      refresh_token: "rt-1",
      client_secret: "cs-1",
      title: "Kickoff"
    }) as Record<string, unknown>;

    expect(recorded.access_token).toBe("[REDACTED]");
    expect(recorded.refresh_token).toBe("[REDACTED]");
    expect(recorded.client_secret).toBe("[REDACTED]");
    expect(JSON.stringify(recorded)).not.toContain("at-1");
    expect(JSON.stringify(recorded)).not.toContain("rt-1");
    // Ordinary data must survive — over-redaction hides what the log exists to show.
    expect(recorded.title).toBe("Kickoff");
    expect(recorded.connectionId).toBe(CONNECTION);
  });
});
