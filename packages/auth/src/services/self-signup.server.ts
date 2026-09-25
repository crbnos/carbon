import { CarbonEdition } from "@carbon/auth";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@carbon/env";
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

/** Shown when the instance has sign-ups switched off. Invites still work. */
export const PLATFORM_SIGNUP_DISABLED_MESSAGE =
  "Sign-ups are disabled on this instance. Ask your administrator for an invitation.";

let platformSignup: { disabled: boolean; at: number } | null = null;

/**
 * Whether this INSTANCE has sign-ups switched off — GoTrue's own
 * `disable_signup`, read from its public settings endpoint.
 *
 * This is the self-hosted counterpart to the Cloud blocklist above. The
 * app's signup path never touches GoTrue's /signup (accounts are created
 * server-side with the service key, which GoTrue exempts by design — that
 * is what keeps invitations working), so without this check the
 * platform's toggle only guarded endpoints nobody calls.
 *
 * Cached for a minute; on a fetch failure the answer is the platform
 * default (sign-ups allowed) rather than locking a Community instance out
 * of its own front door because auth blipped.
 */
export async function isPlatformSignupDisabled(): Promise<boolean> {
  if (CarbonEdition === Edition.Cloud) return false;
  if (platformSignup && Date.now() - platformSignup.at < 60_000) {
    return platformSignup.disabled;
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: SUPABASE_ANON_KEY }
    });
    const settings: { disable_signup?: boolean } = await res.json();
    platformSignup = { disabled: !!settings.disable_signup, at: Date.now() };
  } catch (err) {
    console.warn(
      "could not read auth settings; treating sign-ups as allowed",
      err
    );
    platformSignup = { disabled: false, at: Date.now() };
  }
  return platformSignup.disabled;
}
