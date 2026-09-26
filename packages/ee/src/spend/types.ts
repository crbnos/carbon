/**
 * Install modes for a spend-management platform.
 *
 * A spend platform permits exactly ONE connected accounting provider — the app
 * holding its write scope. So whether Carbon takes that seat is not a setting,
 * it is the shape of the integration, and it decides the OAuth scopes requested
 * at connect time. That is why it is chosen BEFORE consent and is not switchable
 * afterwards: narrowing an already-granted scope set is not reliably possible
 * (Google requires an explicit revoke; Slack's scopes are purely additive; Ramp
 * documents neither), so "switching" would leave a token that still holds the
 * write scope while the UI claims it does not. Changing mode means uninstalling.
 */
export type SpendInstallMode = "provider" | "push-only";

/** The default for any install that predates modes. */
export const DEFAULT_SPEND_INSTALL_MODE: SpendInstallMode = "provider";

export type SpendInstallModeOption = {
  id: SpendInstallMode;
  /** User-facing, shown on the pre-consent chooser. */
  label: string;
  description: string;
  /** The OAuth scopes this mode requests. */
  scopes: readonly string[];
};

export function isSpendInstallMode(
  value: string | null | undefined
): value is SpendInstallMode {
  return value === "provider" || value === "push-only";
}
