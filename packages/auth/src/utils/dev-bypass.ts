// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Whether `email` signs in through the local `DEV_BYPASS_EMAIL` shortcut: the
 * bypass email itself, or a plus-addressed alias of it (`test+admin2@carbon.ms`
 * for `test@carbon.ms`). The aliases are the other dev users the seed adds,
 * such as the second Admin that an Admin-approved request needs.
 *
 * Only the login decides with this; `signInWithBypassEmail` still refuses
 * outside local development.
 */
export function isDevBypassEmail(
  email: string,
  devBypassEmail: string | null | undefined
): boolean {
  if (!devBypassEmail) return false;
  const [local, domain] = splitEmail(email);
  const [bypassLocal, bypassDomain] = splitEmail(devBypassEmail);
  if (!local || !domain || !bypassLocal || !bypassDomain) return false;
  if (domain !== bypassDomain) return false;
  return local === bypassLocal || local.startsWith(`${bypassLocal}+`);
}

function splitEmail(email: string): [string, string] | [] {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1) return [];
  return [normalized.slice(0, at), normalized.slice(at + 1)];
}
