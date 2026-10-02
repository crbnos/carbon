// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Two-way version checks between the app and this server.
 *
 * A self-hosted Carbon can be months behind the store build, and the store
 * build can be months behind a self-hosted Carbon. So neither side infers a
 * feature from its own version:
 *
 * - every response carries `carbon-api: <versions>`, and an app that finds no
 *   version it speaks refuses to sign in ("This Carbon server needs an update");
 * - every request carries `x-carbon-app-version`, and anything older than
 *   MIN_APP_VERSION is answered 426 from the very first `auth/code` call.
 */
export const API_VERSIONS = "1";

/**
 * The oldest app build this server will talk to. Raise it only when an older
 * build would actually misbehave — the two most recent store releases are
 * supported, and a bumped floor locks out every tablet that has not updated.
 */
export const MIN_APP_VERSION = "1.0.0";
