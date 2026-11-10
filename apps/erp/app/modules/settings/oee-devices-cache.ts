// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * The Redis key of an OEE integration's cached device list. Its own module so
 * `settings.server.ts` can clear the key without importing the provider code
 * in `oee-devices.server.ts`.
 */
export const oeeDevicesCacheKey = (companyId: string, integrationId: string) =>
  `oee-devices:${companyId}:${integrationId}`;
