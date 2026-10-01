// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Copyright (C) Carbon Manufacturing Systems Corporation.
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { ZodType } from "zod";
import type {
  ResolvedCapabilities,
  SyncProviderCapabilities
} from "./sync/capabilities";

export type IntegrationAction = {
  id: string;
  label: string;
  description: string;
  endpoint: string;
  /**
   * Name of a boolean setting that must be enabled for this action to be shown.
   * Omit to always show the action on an installed integration.
   */
  enabledWhenSetting?: string;
};

/**
 * A quick-install connector: an external link-out with no DB state, shown
 * above the integrations grid. Each user connects individually.
 */
export type QuickInstallConnector = {
  id: string;
  name: string;
  description: string;
  badge: string;
  installUrl: string;
  logo: React.FC<React.ComponentProps<"svg">>;
};

/**
 * Enhanced option type for select fields.
 * Supports both simple strings (backwards compatible) and objects with label/description.
 */
export type IntegrationSettingOption =
  | string
  | {
      value: string;
      label: string;
      icon?: React.ReactNode;
      description?: string;
    };

/**
 * Definition for an integration setting field.
 */
export type IntegrationSetting = {
  /** Field name used in form data and metadata storage */
  name: string;
  /** Display label for the field */
  label: string;
  /** Optional help text shown below the field */
  description?: string;
  /** Optional group name for organizing settings into collapsible sections */
  group?: string;
  /** Field input type */
  type:
    | "text"
    | "number"
    | "password"
    | "secret"
    | "switch"
    | "processes"
    | "options"
    | "cards"
    | "array";
  /** Options for 'options' type fields */
  listOptions?: IntegrationSettingOption[];
  /** Whether the field is required */
  required: boolean;
  /** Default value for the field */
  value: unknown;
  /**
   * Conditionally render this field only when another field's value matches.
   * Used for provider-based form branching (e.g. show SMTP fields only when provider === "smtp").
   */
  visibleWhen?: { field: string; equals: string | string[] };
  /**
   * Hide this field when THIS INSTALL cannot reach what it configures.
   *
   * Distinct in kind from `visibleWhen`, which reacts live to another field's
   * value in the same form. This is answered once from the install's resolved
   * capabilities (via the descriptor's `resolveInstallCapabilities`), because
   * the same integration installed two ways owns different things — and what it
   * does not own, it must not appear to let the customer configure.
   *
   * A group whose every setting is gated out disappears with them: the form
   * builds its group list from the surviving settings, so there is no separate
   * group-level flag to keep in step.
   *
   * A gated-out setting's STORED value is preserved, not cleared — the form
   * simply omits the field and the save merges over existing metadata. It stays
   * inert because the runtime checks the capability ceiling before the toggle
   * (see `isRampInboundFamilyEnabled`), so a value left over from another mode
   * can never re-enable anything.
   */
  availableWhen?: (capabilities: ResolvedCapabilities) => boolean;
};

/**
 * Definition for a settings group with optional description.
 */
export type IntegrationSettingGroup = {
  /** Group name (must match the group property in settings) */
  name: string;
  /** Optional description shown below the group header */
  description?: string;
};

/**
 * OAuth configuration for integrations that require OAuth authentication.
 * All fields are required to ensure proper OAuth flow.
 */
export type OAuthConfig = {
  /** The OAuth authorization URL */
  authUrl: string;
  /** The OAuth client ID (must be defined, not undefined) */
  clientId: string;
  /** The redirect URI path (relative to the app origin) */
  redirectUri: string;
  /** The OAuth scopes required by the integration */
  scopes: string[];
  /** The OAuth token exchange URL */
  tokenUrl: string;
};

/**
 * Client-side lifecycle hooks.
 * These run in the browser when the user interacts with integration install/uninstall.
 */
export type IntegrationClientHooks = {
  /**
   * Called on the client when user clicks Install button (before any server action).
   * Use this for OAuth popup flows, custom UI, or client-side initialization.
   */
  onClientInstall?: () => void | Promise<void>;
  /**
   * Called on the client when user clicks Uninstall button (before server action).
   * Use this for client-side cleanup or confirmation flows.
   */
  onClientUninstall?: () => void | Promise<void>;
};

/**
 * Server-side lifecycle hooks.
 * These run only on the server and are protected from browser execution.
 */
export type IntegrationServerHooks = {
  /**
   * Server-side hook called after the integration is activated/installed.
   * Use this for creating database subscriptions, webhooks, or other server setup.
   */
  onInstall?: (companyId: string) => void | Promise<void>;
  /**
   * Server-side hook called after the settings of an ALREADY-installed
   * integration are saved. Use this to re-converge derived server state
   * (e.g. event-system subscriptions) so existing installs self-heal when
   * the required set changes. Best-effort: a failure is logged, never
   * rolls back the save.
   */
  onUpdate?: (companyId: string) => void | Promise<void>;
  /**
   * Server-side hook called after the integration is deactivated/uninstalled.
   * Use this for cleaning up server resources, webhooks, etc.
   */
  onUninstall?: (companyId: string) => void | Promise<void>;
  /**
   * Server-side validation hook to check integration health/credentials.
   * Returns true if the integration is healthy, false otherwise.
   */
  onHealthcheck?: (
    companyId: string,
    metadata: Record<string, unknown>
  ) => Promise<boolean>;
};

/**
 * Base configuration for an integration (UI and metadata only).
 */
export type IntegrationConfig = {
  /** Display name of the integration */
  name: string;
  /** Unique identifier used in database and URLs */
  id: string;
  /**
   * Whether the integration is available for use.
   * For OAuth integrations, this must be true AND the OAuth clientId must be configured.
   * Defaults to true if not specified.
   */
  active?: boolean;
  /** Category for grouping in the UI (e.g., "Accounting", "CAD", "Email") */
  category: string;
  /**
   * The BEHAVIOURAL role this integration plays, as opposed to `category`,
   * which stays a display string for badges and grouping.
   *
   * It answers, in one declaration, what five different hard-coded lists answer
   * today: which integrations are accounting providers, which are spend
   * providers, which produce sync operations, and which pairs are mutually
   * exclusive — the database enforces at most one ACTIVE integration per role
   * per company (migration `20260924133915`).
   *
   * Absent = unconstrained. Slack, Jira, Linear, Onshape, Paperless Parts,
   * Email and Stripe Connect declare no role and are never in conflict with
   * anything.
   */
  providerRole?: "accounting" | "spend";
  /** Logo component for the integration */
  logo: React.FC<React.ComponentProps<"svg">>;
  /** Brief one-liner description */
  shortDescription: string;
  /** Full description explaining the integration */
  description: string;
  /** Optional component rendering setup instructions */
  /**
   * Setup steps shown in the details drawer.
   *
   * `mode` is the resolved install mode (see `resolveInstallMode`), so an
   * integration whose modes DO different things can tell the customer what THIS
   * install actually does. Without it the steps describe one mode to every
   * install — Ramp's told a push-only customer to map GL accounts on a tab that
   * mode does not render, and promised inbound syncs it never performs.
   *
   * The other props were already passed by the form behind two
   * `@ts-expect-error`s, which is how the type drifted out of step in the first
   * place.
   */
  setupInstructions?: React.FC<{
    companyId: string;
    metadata?: Record<string, unknown>;
    installed?: boolean;
    mode?: string;
  }>;
  /** Marketing/preview images */
  images: string[];
  /** Configurable settings fields */
  settings: IntegrationSetting[];
  /** Optional group definitions with descriptions */
  settingGroups?: IntegrationSettingGroup[];
  /** Zod schema for validating settings */
  schema: ZodType;
  /** OAuth configuration (if the integration uses OAuth) */
  oauth?: OAuthConfig;
  /**
   * Install modes offered BEFORE consent, each requesting its own scope set.
   *
   * Declared when the integration's shape — not merely its settings — depends on
   * a choice the customer makes up front. A spend platform permits exactly one
   * connected accounting provider, so whether Carbon takes that seat decides
   * which scopes are requested and cannot be changed afterwards without
   * reinstalling. An integration with no `modes` installs exactly as before.
   */
  modes?: IntegrationInstallMode[];
  /**
   * Which of `modes` this install chose, for read-only display.
   *
   * A sibling of `resolveInstallCapabilities` rather than a fixed metadata key,
   * because the key is the integration's own (Ramp stores `syncMode`) and shared
   * settings UI should not know it. The mode is fixed at consent — changing it
   * means reinstalling — so the drawer shows it as a fact, not a control.
   *
   * `detail` is optional supporting context the customer needs to make sense of
   * the mode: for a spend platform in push-only mode, WHICH system holds the
   * accounting connection instead. Undefined means "not known", which is a real
   * state (the read that discovers it is best-effort) and must not be rendered as
   * "nobody".
   */
  resolveInstallMode?: (
    metadata: unknown
  ) => { id: string; detail?: string } | undefined;
  /**
   * Resolve THIS install's sync capabilities from its stored metadata.
   *
   * Declared alongside `modes`: when the mode decides what the integration owns,
   * a static declaration cannot answer, because the same integration installed
   * two ways must answer differently. Pure — it is read by the topology core,
   * which imports no provider.
   */
  resolveInstallCapabilities?: (
    metadata: unknown
  ) => SyncProviderCapabilities | undefined;
  /** Available actions that can be triggered on an installed integration */
  actions?: IntegrationAction[];
};

/**
 * One pre-consent install mode. `scopes` is what the connect route builds the
 * authorize URL from — the descriptor is the single source of truth, so the URL
 * is never assembled from a client-supplied list.
 */
export type IntegrationInstallMode = {
  id: string;
  label: string;
  /**
   * What this mode does. Shown BEFORE consent in the mode picker and, once
   * installed in this mode, wherever the integration would otherwise show its
   * generic description — the generic one describes every mode at once and is
   * therefore wrong for each of them.
   */
  description: string;
  /** Card-length version of `description`. Falls back to `description`. */
  shortDescription?: string;
  scopes: readonly string[];
};

/**
 * Full integration options including all hooks.
 * This is what you pass to defineIntegration().
 */
export interface IntegrationOptions
  extends IntegrationConfig,
    IntegrationClientHooks,
    IntegrationServerHooks {}

/**
 * The return type of defineIntegration().
 * Server hooks are wrapped with getters that enforce server-only execution.
 * The `active` property is computed: must be true AND (if OAuth) clientId must be configured.
 */
export type Integration<T extends IntegrationOptions = IntegrationOptions> =
  Omit<T, keyof IntegrationServerHooks | "active"> & {
    /** Whether the integration is available for use (computed from OAuth config if not set) */
    readonly active: boolean;
    readonly onInstall: T["onInstall"];
    readonly onUninstall: T["onUninstall"];
    readonly onHealthcheck: T["onHealthcheck"];
  };
