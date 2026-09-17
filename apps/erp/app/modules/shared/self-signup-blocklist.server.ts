import { CarbonEdition } from "@carbon/auth";
import { Edition } from "@carbon/utils";

// The list ships with the app (bundled via `?raw`, same as the MCP setup prompt),
// so editing `self-signup-blocked-domains.txt` and deploying is how it's
// maintained. One domain per line; blank lines and `#` comments are ignored.
import blockedDomainsRaw from "./self-signup-blocked-domains.txt?raw";

const blockedDomains = new Set(
  blockedDomainsRaw
    .split("\n")
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
);

/** Shown to the user when their domain is blocked. Kept generic and actionable. */
export const SELF_SIGNUP_BLOCKED_MESSAGE =
  "Please sign up with your work email address. Public email providers aren't supported.";

/**
 * Whether a brand-new self-signup should be refused for this email. Only the
 * Cloud edition enforces the blocklist — self-hosted/enterprise installs manage
 * their own signup gating (edition check in login.tsx, `GOTRUE_DISABLE_SIGNUP`).
 * Existing users are unaffected: the login action only reaches this on the
 * unknown-user signup branch.
 */
export function isSelfSignupBlockedForEmail(email: string): boolean {
  if (CarbonEdition !== Edition.Cloud) return false;
  const domain = email.split("@").pop()?.trim().toLowerCase();
  return !!domain && blockedDomains.has(domain);
}
