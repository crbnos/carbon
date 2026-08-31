/** What Carbon exposes from a third-party integration piece.
 *
 * Curated on purpose: a usable OAuth integration needs an app we register and get
 * verified with the vendor, so breadth is bounded by that, not by this file. The
 * allowlist — not the piece — decides which actions a workflow can reach.
 *
 * It is the one place the workflow side names a vendor: which env vars hold our OAuth
 * app and how to read back which account authorized are fields on the row below, not
 * branches in shared code. A new vendor still needs its own `defineIntegration` card
 * and its three env vars registered in `@carbon/env` — see the checklist in
 * `.claude/rules/workflow-integrations.md`.
 *
 * **Only OAuth2 pieces are supported.** A piece whose auth is `SECRET_TEXT`,
 * `BASIC_AUTH` or `CUSTOM_AUTH` is refused by `getPieceOAuth2Auth` with an
 * `UnsupportedPieceAuthError` — that is deliberate, not an oversight. Those pieces
 * need a different design end to end (a credential form instead of a consent
 * screen, no callback route, no refresh cycle), so they get their own work rather
 * than a special case bolted onto this path.
 */
/** A reviewed decision about one prop of one action. Written when a piece is
 * allowlisted — which is already a deliberate, human-gated step. */
export interface AllowlistPropOverride {
  /** Keep it out of the ordinary form; it still appears under Advanced. */
  hidden?: boolean;
  /** Sent at RUN time when the node supplies nothing, never stored on the node —
   * so changing our mind here fixes every existing workflow at once. */
  value?: unknown;
}

export interface AllowlistEntry {
  package: string;
  /** The EXACT version, no range prefix — `assertPinnedVersions` holds this and
   * package.json together, so an upstream release can never silently change code we
   * execute against a customer's account. */
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
  /** Per-action prop overrides, keyed by action then prop. Only for a vendor
   * default that is WRONG for us — the generic rules in `visibility.ts` handle
   * merely-uninteresting fields with no per-action data. */
  props?: Record<string, Record<string, AllowlistPropOverride>>;
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
    },
    props: {
      google_calendar_get_events: {
        // "Expand Recurring Event?" defaults to FALSE upstream, and an unexpanded
        // recurring event carries the SERIES start date — so a workflow asking for
        // "events tomorrow" silently misses every recurring meeting. Nearly every
        // workflow wants it on, and the vendor's default is simply wrong for us.
        singleEvents: { hidden: true, value: true }
      }
    }
  }
};

/**
 * Refuses a row whose `version` disagrees with the installed dependency, or whose
 * dependency carries a range. Run by the catalog check — without it `version` would
 * be a comment, since the pin that decides which code runs lives in package.json.
 */
export function assertPinnedVersions(
  dependencies: Record<string, string>
): void {
  const problems: string[] = [];

  for (const [pieceName, entry] of Object.entries(PIECE_ALLOWLIST)) {
    const installed = dependencies[entry.package];
    if (installed === undefined) {
      problems.push(`${pieceName}: ${entry.package} is not a dependency.`);
    } else if (installed !== entry.version) {
      problems.push(
        `${pieceName}: the allowlist says ${entry.package}@${entry.version}, package.json says ${installed}.`
      );
    }
  }

  if (problems.length > 0) throw new Error(problems.join("\n"));
}
