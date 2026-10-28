// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { RuntimeValue } from "@carbon/ee/workflows";
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

const SERVICE_ROLE = vi.hoisted(() => ({ role: "service" }));

vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () =>
    SERVICE_ROLE as unknown as SupabaseClient<Database>
}));

// The OAuth app is looked up by the env var NAMES on the allowlist row, so the
// mock answers `getEnv` rather than exporting fixed constants.
const ENV: Record<string, string> = {
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
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

const { runIntegrationAction } = await import("./integration");

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
  runIntegrationAction(
    {
      companyId: COMPANY,
      pieceName: "google-calendar",
      actionName: "create_google_calendar_event",
      inputs: inputs(),
      ...overrides
    },
    getPieceAction
  );

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

  it("checks the connection with the service role, scoped to the run's company", async () => {
    const outcome = await run();
    expect(outcome.ok).toBe(true);
    expect(readConnection).toHaveBeenCalledWith(
      SERVICE_ROLE,
      COMPANY,
      CONNECTION
    );
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

  const pieceThatThrows = (error: unknown) =>
    getPieceAction.mockResolvedValue({
      name: "create_google_calendar_event",
      displayName: "Create Event",
      props: { title: { type: "SHORT_TEXT", required: true } },
      run: async () => {
        throw error;
      }
    });

  // The shape the Activepieces `HttpError` takes: the message embeds the REQUEST
  // body, the vendor's verdict sits on `status` / `responseBody`.
  const httpError = (requestBody: unknown, status: number, body: unknown) =>
    Object.assign(
      new Error(
        JSON.stringify({
          response: { status, body },
          request: { body: requestBody }
        })
      ),
      { status, responseBody: body, requestBody }
    );

  it("maps a Slack scope error to the reconnect copy", async () => {
    pieceThatThrows(
      Object.assign(new Error("An API error occurred: missing_scope"), {
        code: "slack_webapi_platform_error",
        data: { ok: false, error: "missing_scope" }
      })
    );
    const outcome = await run();
    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? "" : outcome.error).toMatch(/needs to be reconnected/);
  });

  it("maps a Google scope refusal to the reconnect copy", async () => {
    pieceThatThrows(
      httpError({ summary: "Kickoff" }, 403, {
        error: {
          code: 403,
          status: "PERMISSION_DENIED",
          errors: [{ reason: "insufficientPermissions" }]
        }
      })
    );
    const outcome = await run();
    expect(outcome.ok ? "" : outcome.error).toMatch(/needs to be reconnected/);
  });

  it("does not read an email body that mentions permissions as a scope error", async () => {
    pieceThatThrows(
      httpError(
        { raw: "Hi, you have insufficient permission to approve this order." },
        400,
        { error: { code: 400, message: "Invalid To header" } }
      )
    );
    const outcome = await run();
    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? "" : outcome.error).toBe(
      "Google Calendar rejected this: Invalid To header"
    );
  });

  it("never stores the request body a vendor error carries", async () => {
    pieceThatThrows(
      httpError({ attendees: ["someone@example.com"] }, 502, "<html>")
    );
    const outcome = await run();
    const error = outcome.ok ? "" : outcome.error;
    expect(error).toBe("Google Calendar rejected this: HTTP 502");
    expect(error).not.toContain("someone@example.com");
  });

  it("never stores the request a googleapis response carries", async () => {
    getPieceAction.mockResolvedValue({
      name: "send_email",
      displayName: "Send Email",
      props: {},
      // A GaxiosResponse: `config.data` is the base64 email it sent.
      run: async () => ({
        config: {
          url: "https://gmail.googleapis.com",
          data: "U2VjcmV0IGJvZHk="
        },
        request: { responseURL: "https://gmail.googleapis.com" },
        data: { id: "msg_1", threadId: "thr_1" },
        status: 200
      })
    });
    const outcome = await run();
    if (!outcome.ok) throw new Error("Expected ok");
    const stored = outcome.outputs.result;
    expect(stored?.kind === "primitive" && stored.value).toBe(
      JSON.stringify({ data: { id: "msg_1", threadId: "thr_1" }, status: 200 })
    );
  });

  it("succeeds when the vendor's result cannot be serialized", async () => {
    // The vendor call already happened; reporting it as rejected would invite a
    // re-run that sends the same message twice.
    const circular: Record<string, unknown> = { id: "evt_1" };
    circular.self = circular;
    getPieceAction.mockResolvedValue({
      name: "create_google_calendar_event",
      displayName: "Create Event",
      props: {},
      run: async () => circular
    });
    const outcome = await run();
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.outputs.result).toEqual({
      kind: "primitive",
      of: "string",
      value: null
    });
  });

  it("stores no result for a vendor call that returned nothing", async () => {
    getPieceAction.mockResolvedValue({
      name: "create_google_calendar_event",
      displayName: "Create Event",
      props: {},
      run: async () => undefined
    });
    const outcome = await run();
    if (!outcome.ok) throw new Error("Expected ok");
    expect(outcome.outputs.result).toEqual({
      kind: "primitive",
      of: "string",
      value: null
    });
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
