// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { AUTH_TOKEN, AuthEmail } from "./AuthEmail";

/** Auth's placeholders, each filled in by Auth when it sends. */
const SITE_URL = "{{ .SiteURL }}";
const TOKEN_HASH = "{{ .TokenHash }}";
const CONFIRMATION_URL = "{{ .ConfirmationURL }}";
/** The requesting app's /callback (emailRedirectTo), so the MES or academy
 * signs in where it was asked, not on the ERP that hosts /magic-link. */
const REDIRECT_TO = "{{ .RedirectTo }}";
const ONCE =
  "Use the code or the button, not both: each email signs you in once.";
const IGNORE = "If you didn't ask for this, you can ignore this email.";

export const AuthMagicLinkEmail = () => (
  <AuthEmail
    preview={`Your Carbon sign-in code is ${AUTH_TOKEN}`}
    eyebrow="Sign in"
    heading="Your sign-in code"
    intro="Enter this code on the Carbon sign-in screen, or sign in with the button below."
    showCode
    action={{
      href: `${SITE_URL}/magic-link?token=${TOKEN_HASH}&redirect_to=${REDIRECT_TO}`,
      label: "Sign in to Carbon"
    }}
    footnote={`${ONCE} If you didn't try to sign in, you can ignore this email.`}
  />
);

export const AuthInviteEmail = () => (
  <AuthEmail
    preview="You have been invited to Carbon"
    eyebrow="Invitation"
    heading="You've been invited to Carbon"
    intro="Accept the invite to set up your Carbon account."
    action={{
      href: `${SITE_URL}/confirm-invite?token=${TOKEN_HASH}`,
      label: "Accept invite"
    }}
    footnote="If you weren't expecting this invite, you can ignore this email."
  />
);

// When this reaches someone signing in, the sign-in screen's code field
// accepts its code: type "email" covers confirmation tokens.
export const AuthConfirmationEmail = () => (
  <AuthEmail
    preview={`Your Carbon confirmation code is ${AUTH_TOKEN}`}
    eyebrow="Confirm email"
    heading="Confirm your email"
    intro="Enter this code on the Carbon sign-in screen, or confirm with the button below."
    showCode
    action={{ href: CONFIRMATION_URL, label: "Confirm email" }}
    footnote={IGNORE}
  />
);

export const AuthRecoveryEmail = () => (
  <AuthEmail
    preview="Reset your Carbon password"
    eyebrow="Security"
    heading="Reset your password"
    intro="Choose a new password for your Carbon account."
    action={{ href: CONFIRMATION_URL, label: "Reset password" }}
    footnote="If you didn't ask to reset your password, you can ignore this email. Your password stays the same."
  />
);

export const AuthEmailChangeEmail = () => (
  <AuthEmail
    preview="Confirm your new email for Carbon"
    eyebrow="Security"
    heading="Confirm your new email"
    intro="Your Carbon email is changing from {{ .Email }} to {{ .NewEmail }}. Confirm to finish the change."
    action={{ href: CONFIRMATION_URL, label: "Confirm new email" }}
    footnote="If you didn't ask for this change, ignore this email and your email stays the same."
  />
);

/**
 * Auth's emails, by the file name Auth downloads each from. Not
 * reauthentication: that email is only a code, and Carbon has no screen to
 * enter it, so Auth keeps its own.
 */
export const authEmails = {
  "magic-link.html": AuthMagicLinkEmail,
  "invite.html": AuthInviteEmail,
  "confirmation.html": AuthConfirmationEmail,
  "recovery.html": AuthRecoveryEmail,
  "email-change.html": AuthEmailChangeEmail
} as const;
