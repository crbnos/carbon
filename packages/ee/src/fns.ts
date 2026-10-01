// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Copyright (C) Carbon Manufacturing Systems Corporation.
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Integration, IntegrationOptions } from "./types";

/**
 * Ensures the code is running on the server.
 * Throws an error if called from the browser.
 */
const withServerOnly = () => {
  if (typeof document !== "undefined") {
    throw new Error(
      `Server only integration hooks cannot be used in the browser`
    );
  }
};

/**
 * Defines an integration with type-safe configuration and server-only hook protection.
 *
 * This function:
 * - Validates required fields at definition time
 * - Computes `active` from OAuth config if not explicitly set
 * - Wraps server-only hooks (onInstall, onUninstall, onHealthcheck) with browser guards
 * - Preserves full type information for the integration config
 *
 * @example
 * ```ts
 * const MyIntegration = defineIntegration({
 *   name: "My Integration",
 *   id: "my-integration",
 *   active: true, // must be true AND clientId must be set for OAuth integrations
 *   category: "Tools",
 *   logo: MyLogo,
 *   description: "...",
 *   shortDescription: "...",
 *   images: [],
 *   settings: [],
 *   schema: z.object({}),
 *   oauth: {
 *     clientId: SOME_CLIENT_ID, // if empty/undefined, integration will be inactive
 *     ...
 *   },
 *   onInstall: async (companyId) => { ... },
 *   onHealthcheck: async (companyId, metadata) => { ... },
 * });
 * ```
 */
export function defineIntegration<
  const ID extends string,
  T extends IntegrationOptions & { id: ID }
>(options: T): Integration<T> {
  // Validate required fields at definition time
  if (!options.id) {
    throw new Error(`Integration must have an 'id' defined`);
  }
  if (!options.name) {
    throw new Error(`Integration '${options.id}' must have a 'name' defined`);
  }

  return {
    ...options,
    /**
     * Computes whether an integration should be active based on its configuration.
     * - If `active` is explicitly false, return false
     * - If the integration has OAuth config, also require clientId to be set and non-empty
     * - Otherwise, use the `active` value (defaults to true)
     */
    get active() {
      const isActive = options.active ?? true;

      // If explicitly inactive, return false
      if (!isActive) {
        return false;
      }

      // If the integration has OAuth config, also require clientId to be configured
      if (options.oauth) {
        return !!options.oauth.clientId;
      }

      return isActive;
    },
    get onInstall() {
      withServerOnly();
      return options.onInstall;
    },
    get onUninstall() {
      withServerOnly();
      return options.onUninstall;
    },
    get onHealthcheck() {
      withServerOnly();
      return options.onHealthcheck;
    }
  } as Integration<T>;
}
