// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Config, Preset } from "@react-router/dev/config";
import { vercelPreset } from "@vercel/react-router/vite";

/**
 * Vercel allows 2048 routes per deployment and its builder spends two on every
 * dynamic route (the page and its `.data`), which the ERP has outgrown. Each of
 * those points at the same function, and that function matches on the request
 * URL, so a dynamic route left out of the build result is still served through
 * the builder's `/(.*)` fallback. Static routes cost no routing entries and stay.
 */
function vercelPresetWithoutDynamicRoutes(): Preset {
  const preset = vercelPreset();
  return {
    ...preset,
    reactRouterConfig: async (args) => {
      const config = await preset.reactRouterConfig?.(args);
      return {
        ...config,
        buildEnd: (buildArgs) => {
          const manifest = buildArgs.buildManifest;
          const bundles = manifest?.routeIdToServerBundleId;
          if (manifest && bundles) {
            const isDynamic = (id: string): boolean => {
              const route = manifest.routes[id];
              return (
                /[:*?]/.test(route.path ?? "") ||
                (route.parentId ? isDynamic(route.parentId) : false)
              );
            };
            // The fallback lands on the index route's function, so a route split
            // into another bundle by a `config` export has to keep its own entry.
            const fallbackBundle = bundles["routes/_index"];
            for (const id of Object.keys(bundles)) {
              if (bundles[id] === fallbackBundle && isDynamic(id)) {
                delete bundles[id];
              }
            }
          }
          return config?.buildEnd?.(buildArgs);
        }
      };
    }
  };
}

export default {
  ssr: true,
  presets: process.env.VERCEL
    ? [vercelPresetWithoutDynamicRoutes()]
    : undefined,
  future: { unstable_optimizeDeps: true, v8_middleware: true, v8_viteEnvironmentApi: true },
  allowedActionOrigins:
    process.env.NODE_ENV === "development"
      ? ["erp.*.dev", "**.localhost"]
      : undefined,
} satisfies Config;
