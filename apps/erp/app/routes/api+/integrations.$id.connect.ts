// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getAppUrl } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { issueOAuthState } from "@carbon/auth/oauth-state.server";
import { getIntegrationIdsByRole, integrations } from "@carbon/ee";
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { buildIntegrationOAuthUrl } from "~/modules/settings/integration-oauth";
import { path } from "~/utils/path";

// nodejs runtime: issuing the signed state cookie.
export const config = {
  runtime: "nodejs"
};

/**
 * Start an OAuth connect, carrying the chosen install mode.
 *
 * The authorize URL is built SERVER-SIDE from the descriptor's declared mode, so
 * the scope list is never assembled from anything the browser supplied. That is
 * the whole reason this route exists rather than the card building the URL: a
 * client-chosen scope list would let someone consent to push-only's narrow scopes
 * while Carbon records a provider-mode install, or the reverse.
 *
 * The mode travels in the signed, HttpOnly state cookie — never a query
 * parameter the callback reads back.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { userId, companyId, client } = await requirePermissions(request, {
    update: "settings"
  });

  const integrationId = params.id;
  const integration = integrations.find((i) => i.id === integrationId);

  if (!integration || !integrationId) {
    return redirect(`${getAppUrl()}${path.to.integrations}?error=not-found`);
  }

  const oauth = "oauth" in integration ? integration.oauth : undefined;
  if (!oauth) {
    return redirect(
      `${getAppUrl()}${path.to.integrations}?error=not-oauth&integration=${integrationId}`
    );
  }

  // Refuse before consent when the integration's role slot is already taken. The
  // database enforces this too (`companyIntegration_single_active_role`), but
  // reaching that refusal AFTER the customer has authorized at the provider
  // leaves them with a live grant and no install.
  const role = (integration as { providerRole?: "accounting" | "spend" })
    .providerRole;
  if (role) {
    const roleIds = new Set<string>(getIntegrationIdsByRole(role));
    const existing = await client
      .from("companyIntegration")
      .select("id")
      .eq("companyId", companyId)
      .eq("active", true);

    const incumbent = (existing.data ?? []).find(
      (row) => row.id && roleIds.has(row.id) && row.id !== integrationId
    );
    if (incumbent?.id) {
      return redirect(
        `${getAppUrl()}${path.to.integrations}?error=role-conflict&integration=${integrationId}&conflictsWith=${incumbent.id}`
      );
    }
  }

  const declaredModes =
    (
      integration as {
        modes?: Array<{ id: string; scopes: readonly string[] }>;
      }
    ).modes ?? [];
  const requestedMode = new URL(request.url).searchParams.get("mode");

  // An unrecognised or absent mode is an ERROR, never a silent default. Falling
  // back to the first mode would request `accounting:write` against a customer
  // who chose push-only — exactly the thing the mode exists to prevent.
  let scopes = oauth.scopes;
  let mode: string | undefined;

  if (declaredModes.length > 0) {
    const chosen = declaredModes.find((m) => m.id === requestedMode);
    if (!chosen) {
      return redirect(
        `${getAppUrl()}${path.to.integrations}?error=invalid-mode&integration=${integrationId}`
      );
    }
    mode = chosen.id;
    scopes = [...chosen.scopes];
  }

  // Pass the request so any OTHER integration's pending state already in the
  // cookie survives this Set-Cookie — the state cookie holds one entry per
  // integration, so two connects can be in flight at once.
  const { state, cookie } = await issueOAuthState(
    {
      integrationId,
      userId,
      companyId,
      mode
    },
    request
  );

  const authorizeUrl = buildIntegrationOAuthUrl(
    { ...oauth, scopes: [...scopes] },
    state,
    getAppUrl()
  );

  if (!authorizeUrl) {
    return redirect(
      `${getAppUrl()}${path.to.integrations}?error=connect-failed&integration=${integrationId}`
    );
  }

  return redirect(authorizeUrl, { headers: { "Set-Cookie": cookie } });
}
