/** What Carbon exposes from a third-party integration piece.
 *
 * Curated on purpose: a usable OAuth integration needs an app we register and get
 * verified with the vendor, so breadth is bounded by that, not by this file. The
 * allowlist — not the piece — decides which actions a workflow can reach.
 *
 * It is also the ONE place a vendor is named. Everything vendor-specific that used
 * to live in shared code — which env vars hold our OAuth app, how to read back which
 * account authorized — is a field on the row below, so adding a vendor edits no
 * shared file.
 *
 * **Only OAuth2 pieces are supported.** A piece whose auth is `SECRET_TEXT`,
 * `BASIC_AUTH` or `CUSTOM_AUTH` is refused by `getPieceOAuth2Auth` with an
 * `UnsupportedPieceAuthError` — that is deliberate, not an oversight. Those pieces
 * need a different design end to end (a credential form instead of a consent
 * screen, no callback route, no refresh cycle), so they get their own work rather
 * than a special case bolted onto this path.
 */
export interface AllowlistEntry {
  /** npm package, pinned exactly in packages/jobs/package.json. */
  package: string;
  version: string;
  label: string;
  actions: readonly string[];
  /**
   * The NAMES of the env vars holding Carbon's OAuth app for this vendor — never
   * the values. This module is imported by build-time catalog scripts, which must
   * never carry a secret, and by the browser-safe settings config indirectly.
   */
  oauth: {
    clientIdEnv: string;
    clientSecretEnv: string;
    redirectUrlEnv: string;
  };
  /**
   * How to read back which account authorized, so a company with two connections
   * can tell them apart. Optional: a vendor with no such endpoint just shows the
   * connection's own name.
   */
  accountLabel?: {
    /** Called once, with the fresh access token as a bearer. */
    url: string;
    /** Which top-level field of the JSON response to display. */
    field: string;
  };
}

export const PIECE_ALLOWLIST: Record<string, AllowlistEntry> = {
  "google-calendar": {
    package: "@activepieces/piece-google-calendar",
    version: "0.10.3",
    label: "Google Calendar",
    actions: ["create_google_calendar_event", "google_calendar_get_events"],
    oauth: {
      clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID",
      clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
      redirectUrlEnv: "GOOGLE_OAUTH_REDIRECT_URL"
    },
    accountLabel: {
      url: "https://www.googleapis.com/oauth2/v2/userinfo",
      field: "email"
    }
  }
};

export type PieceName = keyof typeof PIECE_ALLOWLIST;

export function isAllowlistedPiece(name: string): boolean {
  return PIECE_ALLOWLIST[name] !== undefined;
}
