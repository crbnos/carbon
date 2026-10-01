// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Copyright (C) Carbon Manufacturing Systems Corporation.
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * Values shared by the integration config (bundled for BOTH client and
 * server) and the API client (server-only). They live here, free of imports,
 * because anything `config.tsx` reaches must be safe to serve to the browser —
 * importing these from `client.ts` pulled `@carbon/auth/client.server` into the
 * client bundle, Vite refused to serve it, and the whole app stopped hydrating.
 */

export const MOUNT_DEFAULT_BASE_URL = "https://api.mount.cloud";

export const MOUNT_API_VERSION = "2026-06-01";

export const MOUNT_INTEGRATION_ID = "mount";

export function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
