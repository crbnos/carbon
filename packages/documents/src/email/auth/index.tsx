// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { AUTH_TOKEN, AuthEmail } from "./AuthEmail";

/** Auth's placeholders, each filled in by Auth when it sends. */
const SITE_URL = "{{ .SiteURL }}";
const TOKEN_HASH = "{{ .TokenHash }}";
const CONFIRMATION_URL = "{{ .ConfirmationURL }}";
const ONCE = "The code and the button are the same sign-in: use either, once.";
const IGNORE = "If you didn't ask for this, you can ignore this email.";

export const AuthMagicLinkEmail = () => (
  <AuthEmail
    preview={`Your Carbon sign-in code is ${AUTH_TOKEN}`}
    eyebrow="Sign in"
    heading="Sign in to Carbon"
    intro="Enter this code on the sign-in screen, or use the button below."
    showCode
    action={{
      href: `${SITE_URL}/magic-link?token=${TOKEN_HASH}`,
      label: "Sign in"
    }}
    footnote={`${ONCE} ${IGNORE}`}
  />
);

export const AuthInviteEmail = () => (
  <AuthEmail
    preview="You have been invited to Carbon"
    eyebrow="Invitation"
    heading="You've been invited to Carbon"
    intro="You've been invited to create an account on Carbon."
    action={{
      href: `${SITE_URL}/confirm-invite?token=${TOKEN_HASH}`,
      label: "Accept the invite"
    }}
  />
);

// When this reaches someone signing in, the sign-in screen's code field
// accepts its code: type "email" covers confirmation tokens.
export const AuthConfirmationEmail = () => (
  <AuthEmail
    preview={`Your Carbon sign-in code is ${AUTH_TOKEN}`}
    eyebrow="Sign in"
    heading="Confirm your email"
    intro="Enter this code on the sign-in screen, or use the button below to confirm your email address."
    showCode
    action={{ href: CONFIRMATION_URL, label: "Confirm your email" }}
    footnote={IGNORE}
  />
);

export const AuthRecoveryEmail = () => (
  <AuthEmail
    preview="Reset your Carbon password"
    eyebrow="Security"
    heading="Reset your password"
    intro="Use the button below to reset your password."
    action={{ href: CONFIRMATION_URL, label: "Reset your password" }}
    footnote={IGNORE}
  />
);

export const AuthEmailChangeEmail = () => (
  <AuthEmail
    preview="Confirm your new email for Carbon"
    eyebrow="Security"
    heading="Confirm your new email"
    intro="Confirm the change of your Carbon email from {{ .Email }} to {{ .NewEmail }}."
    action={{ href: CONFIRMATION_URL, label: "Confirm the new email" }}
    footnote={IGNORE}
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
