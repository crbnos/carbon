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
  /** Drop the prop from the step entirely — neither the form nor Advanced offers it.
   * For props whose non-default value needs a host capability Carbon refuses (send as
   * user, mention the origin flow) or a type Carbon cannot render. A `value` is still
   * sent at run time; a required prop needs one. */
  omit?: boolean;
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
    /** Consent endpoint to use instead of the piece's `authUrl` — for a piece that bakes
     * extra requests (Slack's `user_scope=`) into its URL. */
    authUrl?: string;
    /** Scopes to request instead of the piece's full list. Must cover every allowlisted
     * action and the `options()` its dropdowns call. */
    scope?: readonly string[];
  };
  /**
   * How to read back which account authorized, so a company with two connections
   * can tell them apart. Either a field of a GET on the vendor's identity endpoint,
   * or a dot path into the token response itself (Slack returns `team.name`).
   * Optional: a vendor with neither just shows the connection's own name.
   */
  accountLabel?: { url: string; field: string } | { path: string };
  /**
   * Workspace facts to keep on the connection, as `{ metadataKey: tokenResponsePath }`.
   * Slack's token response carries the team, the bot user and the incoming-webhook
   * channel the person picked; the Assistant reads those off the connection. Only the
   * listed paths are copied — a token is never among them.
   */
  metadata?: Record<string, string>;
  /** Per-action prop overrides, keyed by action then prop. Only for a vendor
   * default that is WRONG for us — the generic rules in `visibility.ts` handle
   * merely-uninteresting fields with no per-action data. */
  props?: Record<string, Record<string, AllowlistPropOverride>>;
  /** Per-action: sort the projected list's items by this projected field,
   * ascending, before the size cap. For a vendor that returns results in no
   * useful order (Google's events.list groups a recurring series' instances
   * together), the cap would otherwise cut whole event types instead of the
   * far future. */
  sortItemsBy?: Record<string, string>;
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
    // Google reports the granted scopes too; recorded so a future scope change
    // can be detected the same way as Slack's.
    metadata: { scopes: "scope" },
    // events.list without `orderBy` groups a series' expanded instances into one
    // block; chronological is the only order a calendar question means.
    sortItemsBy: { google_calendar_get_events: "startDateTime" },
    props: {
      google_calendar_get_events: {
        // "Expand Recurring Event?" defaults to FALSE upstream, and an unexpanded
        // recurring event carries the SERIES start date — so a workflow asking for
        // "events tomorrow" silently misses every recurring meeting. Nearly every
        // workflow wants it on, and the vendor's default is simply wrong for us.
        singleEvents: { hidden: true, value: true }
      }
    }
  },
  // One Slack card and one consent serve both the Carbon Assistant and workflow
  // steps; the Assistant reads the oldest Active connection (`getSlackWorkspace`).
  slack: {
    package: "@activepieces/piece-slack",
    version: "0.17.9",
    label: "Slack",
    actions: [
      "send_channel_message",
      "send_direct_message",
      "slack-find-user-by-email",
      "slack-create-channel"
    ],
    oauth: {
      clientIdEnv: "SLACK_CLIENT_ID",
      clientSecretEnv: "SLACK_CLIENT_SECRET",
      redirectUrlEnv: "SLACK_OAUTH_REDIRECT_URL",
      // The piece's own authUrl carries `user_scope=` — a personal user token we never use.
      authUrl: "https://slack.com/oauth/v2/authorize",
      scope: [
        // Assistant: slash commands, issue threads, DMs
        "assistant:write",
        "chat:write.public",
        "commands",
        "files:read",
        "im:history",
        "incoming-webhook", // Slack's channel picker → the Assistant's channel
        "team:read",
        // shared
        "chat:write",
        "users:read", // user dropdown
        "users:read.email", // lookupByEmail
        // workflow steps + dropdowns
        "channels:read", // channel dropdown (conversations.list)
        "groups:read",
        "chat:write.customize", // username / icon props
        "im:write", // DM (conversations.open)
        "channels:manage", // create public channel
        "groups:write" // create private channel
      ]
    },
    accountLabel: { path: "team.name" },
    metadata: {
      team_id: "team.id",
      team_name: "team.name",
      bot_user_id: "bot_user_id",
      channel: "incoming_webhook.channel",
      channel_id: "incoming_webhook.channel_id",
      // NOT `incoming_webhook.url`: a webhook URL is a bearer capability, and
      // metadata is readable by every settings admin.
      scopes: "scope" // the granted bot scopes, one comma-separated string
    },
    props: {
      send_channel_message: {
        // `false` sends as the user, which needs `auth.data.authed_user` — a user token
        // we do not request.
        sendAsBot: { omit: true, value: true },
        // Reads the host flow context, which Carbon's shim refuses.
        mentionOriginFlow: { omit: true },
        // FILE / JSON have no Carbon input.
        file: { omit: true },
        blocks: { omit: true }
      },
      send_direct_message: {
        mentionOriginFlow: { omit: true },
        blocks: { omit: true }
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
