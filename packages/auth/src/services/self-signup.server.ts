import { CarbonEdition } from "@carbon/auth";
import { Edition } from "@carbon/utils";

// The list ships with this package and is bundled into the consuming app (ERP /
// MES) by its Vite build via `?raw`, so editing `self-signup-blocked-domains.txt`
// and deploying is how it's maintained. One domain per line; blank lines and `#`
// comments are ignored.
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
 *
 * Callers gate on "brand-new" themselves so existing users are unaffected:
 * login.tsx/verify.tsx only reach this on the unknown-user signup branch, and
 * the OAuth callback additionally requires no company membership and no pending
 * invite before blocking (an existing gmail employee or an invited contractor
 * is not a self-signup).
 */
export function isSelfSignupBlockedForEmail(email: string): boolean {
  if (CarbonEdition !== Edition.Cloud) return false;
  const domain = email.split("@").pop()?.trim().toLowerCase();
  return !!domain && blockedDomains.has(domain);
}
