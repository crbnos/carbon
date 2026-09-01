import { describe, expect, it } from "vitest";
import { PIECE_ALLOWLIST } from "./allowlist";
import {
  getPieceAction,
  getPieceActions,
  getPieceOAuth2Auth,
  loadPiece,
  UnknownPieceActionError,
  UnknownPieceError
} from "./registry";

describe("piece registry", () => {
  it("loads the installed piece by shape", async () => {
    const piece = await loadPiece("google-calendar");
    expect(typeof piece.actions).toBe("function");
    expect(Object.keys(piece.actions()).length).toBeGreaterThan(0);
  });

  it("resolves an allowlisted action", async () => {
    const action = await getPieceAction(
      "google-calendar",
      "create_google_calendar_event"
    );
    expect(action.displayName).toBe("Create Event");
    expect(action.props.title?.type).toBe("SHORT_TEXT");
  });

  it("exposes only the allowlisted actions", async () => {
    const actions = await getPieceActions("google-calendar");
    expect(Object.keys(actions).sort()).toEqual(
      [...PIECE_ALLOWLIST["google-calendar"]!.actions].sort()
    );
  });

  it("refuses an action the piece has but the allowlist does not", async () => {
    // A real action on the piece — the allowlist, not the piece, is the gate.
    await expect(
      getPieceAction("google-calendar", "custom_api_call")
    ).rejects.toBeInstanceOf(UnknownPieceActionError);
  });

  it("refuses an unknown piece", async () => {
    await expect(getPieceAction("notion", "post")).rejects.toBeInstanceOf(
      UnknownPieceError
    );
  });

  it("returns the OAuth2 member when the piece offers several auth shapes", async () => {
    const auth = await getPieceOAuth2Auth("google-calendar");
    expect(auth.authUrl).toBe("https://accounts.google.com/o/oauth2/auth");
    expect(auth.tokenUrl).toBe("https://oauth2.googleapis.com/token");
    expect(auth.scope).toContain(
      "https://www.googleapis.com/auth/calendar.events"
    );
  });
});

describe("slack", () => {
  it("loads the piece", async () => {
    const piece = await loadPiece("slack");
    expect(Object.keys(piece.actions())).toContain("send_channel_message");
  });

  it("exposes exactly the allowlisted actions", async () => {
    const actions = await getPieceActions("slack");
    expect(Object.keys(actions).sort()).toEqual(
      [...PIECE_ALLOWLIST.slack!.actions].sort()
    );
  });

  it("refuses an action the piece has but the allowlist does not", async () => {
    await expect(getPieceAction("slack", "custom_api_call")).rejects.toThrow();
  });

  // The piece's own consent URL asks for a personal user token as well — the reason
  // the allowlist row overrides `authUrl` and `scope`.
  it("finds the OAuth2 auth, whose authUrl bakes in user scopes", async () => {
    const auth = await getPieceOAuth2Auth("slack");
    expect(auth.tokenUrl).toBe("https://slack.com/api/oauth.v2.access");
    expect(auth.authUrl).toContain("user_scope=");
  });
});
