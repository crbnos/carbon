// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  integrations as availableIntegrations,
  getIntegrationIdsByRole,
  quickInstallConnectors
} from "@carbon/ee";
import { toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useEffect } from "react";
import type { LoaderFunctionArgs } from "react-router";
import {
  data,
  Outlet,
  redirect,
  useLoaderData,
  useSearchParams
} from "react-router";
import { IntegrationsList } from "~/modules/settings";
import { getIntegrationError } from "~/modules/settings/integration-errors";
import { getIntegrationsWithHealth } from "~/modules/settings/settings.server";
import { path } from "~/utils/path";

export const config = {
  runtime: "nodejs"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings"
  });

  const integrations = await getIntegrationsWithHealth(client, companyId);
  if (integrations.error) {
    throw redirect(
      path.to.settings,
      await flash(
        request,
        error(integrations.error, "Failed to load integrations")
      )
    );
  }

  const items = integrations.data.map((i) => {
    // Resolve the install mode HERE, server-side, and send only its id. The
    // card needs it to show copy that matches what this install actually does;
    // shipping the whole `metadata` to the browser to achieve that would hand
    // out credential-adjacent state for every integration.
    const config = availableIntegrations.find((c) => c.id === i.id) as
      | { resolveInstallMode?: (m: unknown) => { id: string } | undefined }
      | undefined;
    return {
      id: i.id!,
      active: i.active!,
      health: i.health,
      installMode: i.active
        ? config?.resolveInstallMode?.(i.metadata)?.id
        : undefined
    };
  });

  // Which role slots are taken. The database refuses a second active
  // integration of a role (migration 20260924133915); this is what stops a
  // customer reaching that refusal through the UI.
  const activeRoles: Record<string, string | null> = {
    accounting: null,
    spend: null
  };
  for (const role of ["accounting", "spend"] as const) {
    const ids = new Set<string>(getIntegrationIdsByRole(role));
    activeRoles[role] =
      items.find((i) => i.active && ids.has(i.id))?.id ?? null;
  }

  return data({
    integrations: items,
    activeRoles
    // No OAuth state here. Every OAuth install now starts at
    // `api+/integrations.$id.connect`, which issues a SIGNED, browser-bound,
    // single-use state — strictly better than the unsigned correlation value this
    // used to hand out, and the only place that can know the chosen mode.
  });
}

export default function IntegrationsRoute() {
  const { integrations } = useLoaderData<typeof loader>();
  const { i18n } = useLingui();
  const [searchParams, setSearchParams] = useSearchParams();

  const integration = searchParams.get("integration");
  const integrationError = searchParams.get("error");

  // An integration's OAuth callback can only redirect the browser, so it reports a
  // failed connect as `?integration=<id>&error=<code>` and the copy is resolved
  // here (see ~/modules/settings/integration-errors).
  useEffect(() => {
    if (!integration) return;

    const failure = getIntegrationError(integration, integrationError);
    if (failure) {
      toast.error(i18n._(failure.title), {
        // Same id for the same failure, so a re-render can't stack duplicates.
        id: `${integration}:${integrationError}`,
        description: i18n._(failure.description)
      });
    }

    // Consume the params either way — a reload shouldn't replay the toast, and an
    // unrecognized code shouldn't linger in the URL.
    setSearchParams(
      (params) => {
        params.delete("integration");
        params.delete("error");
        return params;
      },
      { replace: true, preventScrollReset: true }
    );
  }, [integration, integrationError, i18n, setSearchParams]);

  return (
    <>
      <IntegrationsList
        integrations={integrations}
        // @ts-expect-error TS2322 - TODO: fix type
        availableIntegrations={availableIntegrations}
        quickInstallConnectors={quickInstallConnectors}
      />
      <Outlet />
    </>
  );
}
