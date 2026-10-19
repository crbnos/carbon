// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { getRequestOrigin, redirect, redirectExternal } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { path } from "~/utils/path";

// The integration drawer POSTs and opens the URL it gets back; the callback's
// `refresh` sends the browser here with a GET, to a new onboarding link.
async function handle({ request }: { request: Request }) {
  const api = await carbon(request);
  // Stripe sends the browser back here: the public origin, not request.url's.
  const origin = getRequestOrigin(request) ?? new URL(request.url).origin;
  const result = await api.shared.startStripeConnectOnboarding({ origin });
  const wantsJson =
    request.headers.get("Accept")?.includes("application/json") ||
    request.method === "POST";

  if (result.error) {
    if (wantsJson) {
      return Response.json(
        {
          error: result.error.message,
          // Not a retryable failure: the drawer asks for an administrator.
          isPlatformConfigError: result.error.category === "unavailable"
        },
        { status: 400 }
      );
    }
    throw redirect(
      path.to.integrations,
      await flash(request, error(null, result.error.message))
    );
  }

  if (wantsJson) return Response.json({ redirectUrl: result.data.redirectUrl });
  return redirectExternal(result.data.redirectUrl);
}

export async function loader({ request }: LoaderFunctionArgs) {
  return handle({ request });
}

export async function action({ request }: ActionFunctionArgs) {
  return handle({ request });
}
