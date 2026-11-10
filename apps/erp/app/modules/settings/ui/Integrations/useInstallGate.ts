// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { isIntegrationComingSoon } from "@carbon/ee/plan";
import { useEdition, useRouteData } from "@carbon/react";
import { useUser } from "~/hooks/useUser";
import { path } from "~/utils/path";

export type InstallMode = { id: string; label: string; description: string };

/** Only what the checks read. Structural rather than `Integration`, whose generic
 * variants don't all assign back to the bare type. */
type GatedIntegration = {
  id: string;
  internalOnly?: boolean;
  providerRole?: string;
  modes?: InstallMode[];
  oauth?: unknown;
};

/**
 * What stands between an integration and Install, read once for the card and the
 * Details drawer so the two cannot disagree: the drawer opened by URL used to
 * install past every one of these.
 *
 * - `comingSoon`: the install is withheld (a company that installed it keeps it).
 * - `conflictsWith`: another integration holds the provider role, and a database
 *   trigger allows one active per role, so the install would fail after consent.
 * - `needsModeChoice`: an OAuth install whose mode decides the scopes it asks for.
 */
export function useInstallGate(
  integration: GatedIntegration | undefined,
  installed: boolean
) {
  const routeData = useRouteData<{
    activeRoles: Record<string, string | null>;
    hasEarlyAccess: boolean;
  }>(path.to.integrations);
  const edition = useEdition();
  const user = useUser();

  if (integration === undefined) {
    return {
      comingSoon: false,
      conflictsWith: null,
      modes: [] as InstallMode[],
      needsModeChoice: false
    };
  }

  const comingSoon =
    !installed &&
    isIntegrationComingSoon(integration, {
      edition,
      email: user.email,
      hasEarlyAccess: routeData?.hasEarlyAccess ?? false
    });

  const providerRole = integration.providerRole;
  // Several OEE providers may be active at once (the database exempts the
  // role), so an active one is never an incumbent.
  const roleIncumbent =
    providerRole && providerRole !== "oee"
      ? (routeData?.activeRoles?.[providerRole] ?? null)
      : null;
  const conflictsWith =
    roleIncumbent && roleIncumbent !== integration.id ? roleIncumbent : null;

  const modes = integration.modes ?? [];
  const needsModeChoice = !!integration.oauth && modes.length > 0;

  return { comingSoon, conflictsWith, modes, needsModeChoice };
}
