// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  CARBON_DEPLOYMENT_MODE,
  CarbonEdition,
  CONTROLLED_ENVIRONMENT,
  getCompanies,
  getMESUrl,
  POSTHOG_API_HOST,
  POSTHOG_PROJECT_PUBLIC_KEY,
  SESSION_IDLE_LOCK_MS,
  SUPABASE_ANON_KEY,
  SUPABASE_URL
} from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { isConsoleModeEnabledForCompany } from "@carbon/ee/console.server";
import { meResponse } from "@carbon/mes-core";
import { Edition } from "@carbon/utils";
import {
  getLocationsByCompany,
  getWorkCentersByLocation
} from "~/services/operations.service";
import { apiRoute } from "./lib/route.server";
import { MIN_APP_VERSION } from "./lib/version.server";

/**
 * Everything the app learns about a Carbon, delivered only to a signed-in
 * employee.
 *
 * This is the whole handshake past the server address: before this call the app
 * knows nothing but a hostname. A fixed public document describing the server
 * (the first design) would let one internet scan enumerate every Carbon install
 * with its version and whether it is a controlled environment, so there is no
 * such endpoint — spec Q15.
 */
export const loader = apiRoute(
  // The ONE endpoint that may run without `x-carbon-company`: it is how the app
  // learns which companies it may name. A fresh install has a session and no
  // company, and requiring the header here made first sign-in impossible — the
  // app asked what companies it had and was told to pick one first. When the
  // header is absent the user's first company (by name) answers, and the app
  // sends an explicit one from then on.
  { method: "GET", deps: { companyOptional: true } },
  async ({ user }) => {
    if (!user) throw new Error("unreachable: /me is not public");
    const { companyId, sessionUserId, claims } = user;
    const serviceRole = getCarbonServiceRole();

    const can = (module: string, action: "view" | "create" | "update") =>
      claims.permissions[module]?.[action]?.includes(companyId) ?? false;

    const [profile, companies, locations, consoleAvailable] = await Promise.all(
      [
        serviceRole
          .from("user")
          .select("id, email, fullName, avatarUrl")
          .eq("id", sessionUserId)
          .single(),
        getCompanies(user.client, sessionUserId),
        getLocationsByCompany(user.client, companyId),
        isConsoleModeEnabledForCompany(user.client, companyId)
      ]
    );

    if (profile.error || !profile.data) {
      throw new Error("Could not read the signed-in user");
    }

    // The employee's own default location, which the app preselects — the same
    // row the web shell reads to scope its pages.
    const employeeJob = await serviceRole
      .from("employeeJob")
      .select("locationId")
      .eq("id", sessionUserId)
      .eq("companyId", companyId)
      .maybeSingle();

    const locationIds = (locations.data ?? []).map((l) => l.id);
    const workCenters = (
      await Promise.all(
        locationIds.map(async (locationId) => {
          const result = await getWorkCentersByLocation(
            user.client,
            locationId
          );
          return (result.data ?? []).map((wc) => ({
            id: wc.id as string,
            name: (wc.name as string) ?? "",
            locationId
          }));
        })
      )
    ).flat();

    // Analytics only where the operator's own deployment allows it: never
    // self-hosted (no key is configured), never air-gapped, never ITAR.
    const analyticsAllowed =
      CarbonEdition === Edition.Cloud &&
      !CONTROLLED_ENVIRONMENT &&
      CARBON_DEPLOYMENT_MODE === "connected";

    const payload = {
      instance: {
        name:
          CarbonEdition === Edition.Cloud
            ? "Carbon Cloud"
            : new URL(getMESUrl()).hostname,
        // The PUBLIC url. SUPABASE_INTERNAL_URL is a cluster-internal address the
        // device can never route to.
        supabaseUrl: SUPABASE_URL,
        supabaseAnonKey: SUPABASE_ANON_KEY,
        mode: CARBON_DEPLOYMENT_MODE,
        controlledEnvironment: CONTROLLED_ENVIRONMENT,
        idleLockMs: SESSION_IDLE_LOCK_MS,
        minAppVersion: MIN_APP_VERSION,
        analytics: analyticsAllowed
          ? {
              posthogKey: POSTHOG_PROJECT_PUBLIC_KEY,
              posthogHost: POSTHOG_API_HOST
            }
          : null
      },
      user: {
        id: profile.data.id,
        email: profile.data.email,
        name: profile.data.fullName ?? profile.data.email,
        avatarUrl: profile.data.avatarUrl ?? null
      },
      companies: (companies.data ?? []).map((c) => ({
        id: c.companyId as string,
        name: (c.name as string) ?? ""
      })),
      locations: (locations.data ?? []).map((l) => ({
        id: l.id,
        name: l.name ?? "",
        companyId
      })),
      defaultLocationId: employeeJob.data?.locationId ?? null,
      workCenters,
      consoleAvailable: consoleAvailable === true,
      permissions: {
        production: {
          view: can("production", "view"),
          create: can("production", "create"),
          update: can("production", "update")
        },
        inventory: {
          view: can("inventory", "view"),
          update: can("inventory", "update")
        },
        quality: { create: can("quality", "create") },
        settings: { update: can("settings", "update") }
      }
    };

    // Validate our OWN response: a shape the app's zod would reject must fail
    // here, in this server's tests, not at runtime on a tablet.
    return meResponse.parse(payload);
  }
);
