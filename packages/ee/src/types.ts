import type { ZodType } from "zod";

export type IntegrationAction = {
  id: string;
  label: string;
  description: string;
  endpoint: string;
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
  /** Logo component for the integration */
  logo: React.FC<React.ComponentProps<"svg">>;
  /** Brief one-liner description */
  shortDescription: string;
  /** Full description explaining the integration */
  description: string;
  /** Optional component rendering setup instructions */
  setupInstructions?: React.FC<{ companyId: string }>;
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
  /** Available actions that can be triggered on an installed integration */
  actions?: IntegrationAction[];
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
