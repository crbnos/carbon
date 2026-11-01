// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/** The private bucket that holds every user's signature images. */
export const SIGNATURES_BUCKET = "signatures";

/**
 * Whether `path` is a signature file in `userId`'s own folder of the
 * `signatures` bucket (`${userId}/<file>`). A user can write any text into
 * their own `user.signaturePath` through the API, and the server reads the
 * file with the service role, so every reader checks this before trusting a
 * path: otherwise a user could print someone else's signature.
 */
export function isOwnSignaturePath(
  userId: string | null | undefined,
  path: string | null | undefined
): path is string {
  if (!userId || !path) return false;
  const file = path.slice(userId.length + 1);
  return (
    path.startsWith(`${userId}/`) && /^[A-Za-z0-9_-]+\.(png|jpe?g)$/.test(file)
  );
}
